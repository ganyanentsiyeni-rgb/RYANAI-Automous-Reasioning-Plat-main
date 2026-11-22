#!/usr/bin/env bash
set -euo pipefail

SUPABASE_CLI=(npx --yes supabase@3.0.0)
DB_URL=""
SUPABASE_STARTED=0

log() {
  printf '\n[%s] %s\n' "ephemeral-supabase" "$1"
}

cleanup() {
  local exit_code=$?
  if [ "$SUPABASE_STARTED" = "1" ]; then
    printf '\n[ephemeral-supabase] Stopping isolated Supabase stack...\n'
    "${SUPABASE_CLI[@]}" stop --no-backup >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the disposable local Supabase stack." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "The PostgreSQL client (psql) is required to assert the local Supabase schema." >&2
  exit 1
fi

log "Starting pinned Supabase CLI local stack"
"${SUPABASE_CLI[@]}" start
SUPABASE_STARTED=1

log "Applying the complete committed Supabase migration chain to a fresh local database"
"${SUPABASE_CLI[@]}" db reset --local

# Supabase status emits local service keys as well as DB_URL. Capture it only
# into the current shell; never print or persist the full output.
eval "$("${SUPABASE_CLI[@]}" status --env)"
DB_URL="${DB_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "Supabase CLI did not provide DB_URL." >&2
  exit 1
fi
export DATABASE_URL="$DB_URL"
export TEST_DATABASE_URL="$DB_URL"
export RYANAI_DISPOSABLE_DB=1
export RYANAI_DISPOSABLE_SUPABASE=1
export NODE_ENV=test

node --input-type=module -e '
const u = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname) || u.pathname !== "/postgres") {
  throw new Error("Refusing tests: expected the local Supabase postgres database on loopback.");
}
'

log "Verifying Supabase Auth, Storage, identity bridge, and RLS baseline"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RAISE EXCEPTION 'auth.users missing'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'auth.uid() missing'; END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage schema missing';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.conversations') IS NULL THEN
    RAISE EXCEPTION 'Supabase application baseline tables missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'select_own_profile'
  ) THEN RAISE EXCEPTION 'profiles owner RLS policy missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Auth profile identity trigger missing'; END IF;
END $$;
SQL

log "Generating Prisma client"
npx prisma generate --schema=prisma/schema.prisma

log "Recording the no-op Prisma marker only after the real Supabase migrations have completed"
npx prisma migrate resolve --applied 20261014000000_supabase_platform_baseline --schema=prisma/schema.prisma

log "Applying the committed Prisma application migration chain"
npx prisma migrate deploy --schema=prisma/schema.prisma

log "Verifying Prisma-owned agent runtime tables after migrations"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $assert$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RAISE EXCEPTION 'Prisma public.users missing'; END IF;
  IF to_regclass('public.agent_runs') IS NULL THEN RAISE EXCEPTION 'Prisma public.agent_runs missing'; END IF;
  IF to_regclass('public.agent_handoffs') IS NULL THEN RAISE EXCEPTION 'Prisma public.agent_handoffs missing'; END IF;
  IF to_regclass('public.agent_brain_health') IS NULL THEN RAISE EXCEPTION 'Prisma public.agent_brain_health missing'; END IF;
  IF to_regclass('public.agent_run_evidence') IS NULL THEN RAISE EXCEPTION 'Prisma public.agent_run_evidence missing'; END IF;
  IF to_regclass('public.communication_messages') IS NULL THEN RAISE EXCEPTION 'Prisma Comms message table missing'; END IF;
END $assert$;
SQL

log "Checking the resulting Prisma schema contract"
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

log "Verifying lease migration inverse DDL and transactional rollback"
node scripts/test-agent-run-lease-migration-rollback.mjs

log "Building server output required by the durable-queue integration runner"
npm run build:server

log "Running PostgreSQL durable-queue integration tests"
NODE_ENV=test node --import tsx scripts/test-agent-queue.mjs

log "Running PostgreSQL intelligence-event inbox audit atomicity tests"
node --import tsx scripts/test-intelligence-event-inbox-postgres.mjs

log "Running Comms Twilio callback integration and disposable teardown tests"
RUN_COMMS_POSTGRES_INTEGRATION=true npx vitest run src/server/comms/index.postgres.integration.test.ts

log "Running guarded agent_runs migration replay/idempotency test"
node scripts/test-agent-runs-runtime-migration-upgrade.mjs

log "Disposable local Supabase + Prisma integration completed successfully"
