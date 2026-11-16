# RyanAI database schema reconciliation — design draft

**Status:** Draft; not owner-approved.  
**EGM independent review:** Blocked — fresh Goldfish subagent contexts are unavailable in this environment.

## Problem and evidence

The database verification pipeline has exposed schema/migration drift. A successful migration image build or an existing table does not establish that all migration ledgers and runtime consumers agree.

Known evidence:
- PR #1389 exact-head database workflow run `42510586247`, job `128822559219`, successfully built and ran the one-shot migration image twice, then failed the final Prisma schema-diff gate (exit code 2).
- That schema diff reported changes across Communication, PA, Plugin Authorization, Quant, Security and Studio tables: missing/extra tables; a missing `communication_conversations(owner_user_id, updated_at)` index; missing PA primary keys and FK mismatches; a removed Plugin Authorization connection FK; multiple Quant paper-order/user/experiment FKs and an order-proposal status/expiry index missing from the actual migrated database; Security FK differences; missing Studio owner-user FKs; and the missing `studio_worker_heartbeats(status, last_seen_at)` index.
- PR #1389's standalone ephemeral PostgreSQL dry-run failed with Prisma `P3018` / SQLSTATE `42704` because the CI script did not provision the Supabase `anon` role before applying the Supabase Auth identity-bridge migration. PR #1394 proposes adding the existing CI-only Auth bootstrap fixture to that script.
- PR #1389's Supabase migration replay failed on malformed Community Survey DDL (a duplicate `CREATE TABLE` block with a missing closing delimiter). PR #1390 corrected that migration, but no successful replay of the corrected exact head is established yet.
- The wider platform programme (issue #1292) records duplicate migration ownership / fresh-stack P3005 concerns and excludes the coding-task queue migration pending independent data classification.
- No production DDL is authorized.

## Goals

1. Establish the authoritative owner of each schema object and migration ledger.
2. Reconcile Prisma schema, Prisma migrations, Supabase migrations, actual SQL consumers and deployed database state.
3. Resolve each drift item with a reviewed forward migration and rollback/recovery plan.
4. Keep isolated audiobook schema and Supabase Auth identity bridge boundaries intact.
5. Preserve data and avoid destructive or speculative migrations.

## Proposed workflow

1. Inventory tables, columns, indexes, constraints, extensions, owners, RLS/grants and all SQL consumers.
2. Map every object to exactly one migration owner (Prisma or Supabase); document cross-ledger dependencies explicitly.
3. Reproduce the current failures in disposable PostgreSQL/Supabase databases.
4. Produce a drift matrix: expected source, actual disposable state, actual production state if safely observable, ownership, migration path, data risk and test evidence.
5. Draft one narrow migration per coherent ownership boundary. Do not combine unrelated Studio, Quant, survey or queue changes.
6. Validate empty install, upgrade from the supported migration ledger, repeatability, rollback/recovery and schema diff.
7. Obtain owner approval before any production migration; production migration is a separate authorization.

## Explicit exclusions

- No production DDL or migration execution.
- No coding-task queue migration until its data classification is independently reviewed.
- No disabling or relaxing Prisma schema-diff gates.
- No speculative foreign-key additions or destructive cleanup.
- No credential or connection-string changes.

## Acceptance criteria

- [ ] Migration ownership matrix is complete.
- [ ] Fresh-stack install succeeds from an empty disposable database.
- [ ] Supported upgrade paths replay successfully and idempotently where designed.
- [ ] Prisma and Supabase schema comparisons have no unexplained drift.
- [ ] Studio heartbeat index and ownership constraints are reconciled with actual consumers.
- [ ] Quant paper-table relationships are reconciled with the paper-only execution boundary.
- [ ] Survey tables, API grants and separate Beta-interest data are verified.
- [ ] Backup, rollback and recovery plans are reviewed before any production DDL.
- [ ] Exact-head migration, integration and schema checks pass.

## Review and approval

Goldfish review: blocked; fresh reviewer contexts not executed. Human architecture review and owner approval are required before migration implementation.
