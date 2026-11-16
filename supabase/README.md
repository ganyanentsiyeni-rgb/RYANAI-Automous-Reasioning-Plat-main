# RyanAI database migrations

RyanAI has two migration systems with deliberately separate ownership:

- `supabase/migrations/` is authoritative for Supabase-managed objects: Auth-linked `profiles`, `conversations`, `messages`, and `memory_entries`; Storage buckets and attachment enforcement; RLS, grants, and Supabase-specific Comms objects including message idempotency.
- `prisma/migrations/` is authoritative for RyanAI application-owned objects such as `public.users`, `public.agent_runs`, agent operations, reasoning memory, and the requested-model field.
- Some Supabase-owned tables are also represented in `prisma/schema.prisma` so the API can access them through Prisma. The historical Prisma compatibility migrations use `IF NOT EXISTS` for these shared mappings; in a Supabase-hosted install, the Supabase migration stage creates those objects first and remains their owner. Do not add a second non-idempotent owner or move Supabase RLS/Storage policy DDL into Prisma.

The two migration histories remain separate. `supabase db reset` does not execute Prisma migrations, and Prisma does not own Supabase Auth/Storage policies. The combined install must replay Supabase first, initialize the Prisma ledger with the committed no-op platform-baseline marker, and then replay Prisma application migrations. Do not copy versions from a hosted ledger into either source tree or use `migration repair` to conceal missing DDL.

## Complete fresh local setup

Run both migration stages against the same disposable local Supabase database:

```sh
supabase start
supabase db reset --local
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx prisma migrate resolve --applied 20261014000000_supabase_platform_baseline --schema=prisma/schema.prisma
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx prisma migrate deploy --schema=prisma/schema.prisma
```

The committed no-op migration `20261014000000_supabase_platform_baseline` initializes Prisma's ledger after the Supabase platform schema is present. It records the boundary only; it creates no tables or columns. The first real Prisma application migration still runs normally.

The CI job **Verify Supabase and Prisma fresh-stack migrations** exercises this sequence and verifies that:

- the Supabase-owned migration ledger records the Comms idempotency migration;
- the Prisma ledger records the platform-baseline marker before the application migrations;
- the Prisma migration ledger records `20261107160000_agent_requested_model`;
- `public.agent_runs.requested_model` and `public.agent_runs.queue_type` exist after Prisma replay;
- the complete `public.coding_tasks` table, required indexes, and foreign keys are present;
- the Supabase-owned `public.communication_messages.idempotency_key` remains present;
- a separate disposable upgrade path verifies pre-existing workbench rows are isolated into the coding queue, exercises a valid coding-task insert/delete, and repeats migration replay without changing the result.

Running only `supabase db reset` produces the Supabase platform baseline, not the complete RyanAI application schema. A separate disposable upgrade test also starts from the older Prisma migration ledger, introduces the no-op marker, completes the later migrations, and repeats deploy to prove the new marker is restart-safe. The hosted production ledger is not rewritten by CI.

## Hosted databases

Never use a local reset or an unreviewed `supabase db push` as a production repair. Hosted application-schema changes are applied only through the protected, explicitly approved production-migration workflow after exact-commit CI/security evidence and independent environment review. A successful local replay does not authorize a production migration.
