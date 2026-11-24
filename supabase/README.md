# RyanAI database migrations

RyanAI has two migration systems with deliberately separate ownership:

- `supabase/migrations/` is authoritative for Supabase-managed objects: Auth-linked `profiles`, `conversations`, `messages`, and `memory_entries`; Storage buckets and attachment enforcement; RLS, grants, and Supabase-specific Comms objects including message idempotency.
- `prisma/migrations/` is authoritative for RyanAI application-owned objects such as `public.users`, `public.agent_runs`, agent operations, reasoning memory, and the requested-model field.
- Some Supabase-owned tables are also represented in `prisma/schema.prisma` so the API can access them through Prisma. The historical Prisma compatibility migrations use `IF NOT EXISTS` for these shared mappings; in a Supabase-hosted install, the Supabase migration stage creates those objects first and remains their owner. Do not add a second non-idempotent owner or move Supabase RLS/Storage policy DDL into Prisma.

The two migration histories remain separate for ongoing changes. The Supabase chain includes a one-time `20261122000000_prisma_runtime_schema_bootstrap.sql` compatibility migration for the U2EB combined environment. It materializes the committed Prisma runtime schema snapshot and seeds matching Prisma migration-ledger rows/checksums after the Supabase platform objects are created. This is a bootstrap bridge, not a transfer of ongoing ownership: new RyanAI application-schema changes remain in `prisma/migrations/`, while Supabase Auth, Storage, RLS and Supabase-specific objects remain in `supabase/migrations/`. After `supabase db reset`, do not run `prisma migrate resolve` for the baseline marker; the bootstrap has already recorded it and a second resolve fails with P3008. Run `prisma migrate deploy` to apply any Prisma migrations newer than the bootstrap snapshot.

## Complete fresh local setup

Run both migration stages against the same disposable local Supabase database:

```sh
supabase start
supabase db reset --local
eval "$(supabase status -o env)"
DATABASE_URL="$DB_URL" npx prisma migrate deploy --schema=prisma/schema.prisma
```

The one-time Supabase runtime bootstrap records `20261014000000_supabase_platform_baseline` in Prisma's ledger and imports the matching historical Prisma migration checksums and schema snapshot. The follow-up `prisma migrate deploy` must be restart-safe and apply only migrations added after that snapshot. Do not manually resolve the baseline a second time.

The CI job **Verify Supabase and Prisma fresh-stack migrations** exercises this sequence and verifies that:

- the Supabase-owned migration ledger records the Comms idempotency migration;
- the Prisma ledger records the platform-baseline marker before the application migrations;
- the Prisma migration ledger records `20261107160000_agent_requested_model`;
- `public.agent_runs.requested_model` and `public.agent_runs.queue_type` exist after Prisma replay;
- the complete `public.coding_tasks` table, required indexes, and foreign keys are present;
- the Supabase-owned `public.communication_messages.idempotency_key` remains present;
- a separate disposable upgrade path verifies pre-existing workbench rows are isolated into the coding queue, exercises a valid coding-task insert/delete, and repeats migration replay without changing the result.

A fresh `supabase db reset` now applies the Supabase platform chain plus the one-time Prisma runtime bootstrap snapshot. The subsequent Prisma deploy verifies and advances the Prisma-owned history without re-resolving the already-recorded baseline. Separate Prisma-only disposable tests continue to exercise the standalone migration path. The hosted production ledger is not rewritten by CI.

## Hosted databases

Never use a local reset or an unreviewed `supabase db push` as a production repair. Hosted application-schema changes are applied only through the protected, explicitly approved production-migration workflow after exact-commit CI/security evidence and independent environment review. A successful local replay does not authorize a production migration.
