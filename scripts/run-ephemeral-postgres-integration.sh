#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${POSTGRES_TEST_CONTAINER:-ryan-postgres-test-ephemeral}"
DB_PORT="${POSTGRES_TEST_PORT:-5432}"
DB_NAME="${POSTGRES_TEST_DB:-ryan_ai_test}"
DB_USER="${POSTGRES_TEST_USER:-postgres}"
DB_PASSWORD="${POSTGRES_TEST_PASSWORD:-postgres}"
POSTGRES_IMAGE="${POSTGRES_TEST_IMAGE:-pgvector/pgvector:pg15}"
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}?schema=public"

log() {
  printf '\n[%s] %s\n' "ephemeral-postgres" "$1"
}

cleanup() {
  local exit_code=$?
  printf '\n[ephemeral-postgres] Cleaning up %s...\n' "${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the ephemeral PostgreSQL dry-run." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  log "Removing stale container ${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

log "Starting isolated PostgreSQL container (${POSTGRES_IMAGE})"
docker run --detach \
  --name "${CONTAINER_NAME}" \
  --env POSTGRES_USER="${DB_USER}" \
  --env POSTGRES_PASSWORD="${DB_PASSWORD}" \
  --env POSTGRES_DB="${DB_NAME}" \
  --publish "${DB_PORT}:5432" \
  "${POSTGRES_IMAGE}" >/dev/null

log "Waiting for PostgreSQL to accept connections"
max_retries="${POSTGRES_TEST_MAX_RETRIES:-30}"
retry=0
until docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
  retry=$((retry + 1))
  if [ "${retry}" -ge "${max_retries}" ]; then
    echo "PostgreSQL did not become ready within ${max_retries} seconds." >&2
    exit 1
  fi
  sleep 1
done

log "PostgreSQL is ready: ${DB_URL}"
export DATABASE_URL="${DB_URL}"
export TEST_DATABASE_URL="${DB_URL}"
export RYANAI_DISPOSABLE_DB=1

log "Provisioning minimal Supabase Auth roles and schema for Prisma migration tests"
docker run --rm --network host \
  --env PGPASSWORD="${DB_PASSWORD}" \
  --volume "${PWD}/tests/fixtures/supabase-auth-ci-bootstrap.sql:/tmp/supabase-auth-ci-bootstrap.sql:ro" \
  postgres:16-alpine psql \
    -h 127.0.0.1 -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -v ON_ERROR_STOP=1 -f /tmp/supabase-auth-ci-bootstrap.sql

log "Generating Prisma client"
npx prisma generate --schema=prisma/schema.prisma

log "Recording the Supabase platform baseline in the disposable Prisma ledger"
npx prisma migrate resolve --applied 20261014000000_supabase_platform_baseline --schema=prisma/schema.prisma

log "Applying the committed Prisma migration chain to the disposable database"
npx prisma migrate deploy --schema=prisma/schema.prisma

log "Checking the resulting Prisma schema contract"
npx prisma migrate diff \
  --from-url "${DB_URL}" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

log "Running PostgreSQL durable-queue integration tests"
# This script imports TypeScript application modules whose ESM imports use
# emitted .js specifiers. Register tsx so the disposable test runner resolves
# those source modules consistently without changing production imports.
node --import tsx scripts/test-agent-queue.mjs

log "Running guarded agent_runs migration replay/idempotency test"
node scripts/test-agent-runs-runtime-migration-upgrade.mjs

log "Ephemeral PostgreSQL dry-run completed successfully"
