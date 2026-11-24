# RyanAI database migration ownership and reproducibility

## Schema ownership

RyanAI has two migration histories with different responsibilities. They are not interchangeable and must not be merged by copying timestamps or marking migrations applied without validating their DDL.

- **Prisma migrations** (`prisma/migrations/`) own RyanAI application objects such as `public.users`, `public.agent_runs`, agent operations, reasoning memory, and `requested_model`.
- **Supabase CLI migrations** (`supabase/migrations/`) own Auth-linked `profiles`, `conversations`, `messages`, and `memory_entries`, shared-room tables (`rooms`, `room_members`, `room_messages`), plus Storage buckets/enforcement, RLS, grants, and Supabase-specific Comms objects.
- Some Supabase-owned tables are represented in `prisma/schema.prisma` for API access. Existing Prisma compatibility migrations use idempotent `IF NOT EXISTS` DDL for these mappings so a Prisma-only database can still be provisioned; in the combined Supabase-hosted install, the Supabase stage creates these shared objects first and is their owner. The shared-room Prisma compatibility migration creates only the table/index contract for Prisma-only disposable installs; its Supabase counterpart owns Auth-linked RLS policies and helper functions. Do not introduce a second non-idempotent owner or move Supabase RLS/Storage DDL into Prisma.

The Supabase chain now includes a one-time `20261122000000_prisma_runtime_schema_bootstrap.sql` compatibility migration for the U2EB combined environment. It imports the committed Prisma runtime schema snapshot and seeds the matching Prisma migration-ledger rows/checksums after the Supabase platform objects are created. This bootstrap does not transfer ongoing ownership: new RyanAI application-schema changes remain in `prisma/migrations/`, while Auth, Storage, RLS and Supabase-specific objects remain in `supabase/migrations/`. After a Supabase reset, the baseline marker is already recorded; running `prisma migrate resolve` again is incorrect and returns P3008.

## Supported fresh-install paths

### 1. Prisma application database

1. Provision an empty disposable PostgreSQL database and the minimum Auth compatibility fixture required by the identity-bridge migration.
2. Run `prisma migrate deploy` against `prisma/schema.prisma`.
3. Verify `public.agent_runs` exists and contains `requested_model`.
4. Verify the successful Prisma ledger records `20261030120000_agent_operations` before `20261107160000_agent_requested_model`.
5. Run `prisma migrate deploy` a second time and verify it is a no-op.

### 2. Supabase-hosted RyanAI application

1. Start a disposable local Supabase stack and run `supabase db reset --local`.
2. Verify the Supabase platform objects and the one-time Prisma runtime bootstrap are present, including the Prisma baseline marker and `public.agent_runs` runtime schema.
3. Do not resolve the baseline marker again; the Supabase bootstrap has already seeded it and the matching historical Prisma checksums.
4. Run `prisma migrate deploy` against that same local Supabase PostgreSQL database to apply any Prisma migrations added after the bootstrap snapshot.
5. Verify `agent_runs` and `requested_model` exist, the baseline marker precedes the Prisma application migrations, both migration ledgers retain their own successful entries, and the `agent_runs` migration precedes `requested_model`.
6. Compare the final database to `prisma/schema.prisma`, then run Prisma deploy a second time and verify the completed schema remains intact.

The Supabase local reset also runs the explicitly configured `supabase/migrations/seed.sql`, which is intentionally comment-only. The combined path includes the one-time runtime bootstrap migration; the standalone Prisma path remains a separate test of Prisma-only fresh installs.

## Existing database safety

- Keep migrations additive and idempotent where safe; do not create a second copy of an application table to compensate for a missing migration-history file.
- The Prisma platform-baseline marker is a no-op in `prisma/migrations/`. In the combined U2EB path, the one-time Supabase runtime bootstrap imports the verified Prisma snapshot and seeds the marker/checksums. Do not run a second `migrate resolve` after that bootstrap.
- The disposable pgvector upgrade test starts with the historical Prisma ledger before this marker existed, then adds the marker and runs all pending migrations twice. This verifies that an existing Prisma ledger can accept the marker without rewriting prior migration records.
- Do not replay or baseline application migrations on an already provisioned hosted database unless the Prisma ledger, Supabase ledger, actual schema, and data impact have been reconciled.
- Do not use `supabase migration repair` as a substitute for applying or verifying DDL. It changes migration-history metadata, not the database schema.
- Do not run `supabase db push` against a hosted project while local migration files and the remote Supabase migration ledger are divergent.
- Compare both ledgers and actual schema before any repair. A history-only reconciliation requires its own reviewed plan.
- Production database migrations and deployments remain separate approval gates. CI must use disposable local databases only.

## CI acceptance criteria

The database workflow must prove, on the exact pull-request head:

- Prisma-only fresh install applies the no-op platform marker and creates `agent_runs` before `requested_model`.
- Supabase CLI reset applies the platform migrations and the one-time Prisma runtime bootstrap; the subsequent Prisma deploy is restart-safe and applies only any migrations newer than that snapshot.
- Both migration ledgers contain their own expected successful records and preserve their distinct ownership.
- The legacy-upgrade path can introduce the marker after the historical ledger, then complete pending migrations.
- A second Prisma deploy is restart-safe and the final database matches the Prisma data model.
- The isolated coding-queue upgrade test seeds pre-existing reasoning/workbench rows before the queue migration, then verifies `queue_type` classification after the follow-up correction migration, every `coding_tasks` column, required indexes and foreign keys, and a disposable insert/delete. The original `20261104120000_isolated_coding_task_queue` migration remains checksum-stable; `20261108120000_correct_pending_reasoning_queue_classification` moves legacy pending rows without plan/diff evidence out of the coding queue.
- The queue upgrade test repeats Prisma deploy and reruns the assertions to prove migration replay is idempotent. The production coding-queue migration remains held for independent data-impact review; CI replay does not authorize production application.
- The Prisma schema readiness audit passes after the combined install.

A queued, skipped, cancelled, missing, or stale-head check is not a pass. Human review is required before merge.
