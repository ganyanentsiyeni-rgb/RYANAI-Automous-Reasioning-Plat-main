# Agent-run runtime schema contract repair

## Scope

This additive migration restores the runtime columns and indexes required by the current Prisma `AgentRun` model and reasoning worker SQL. The production database inspection on 8 November 2026 found that `public.agent_runs` lacked these runtime-contract fields.

## Actual migration behavior

The migration **does reclassify existing rows**. Its first update sets `approval_status = 'pending'` for rows whose `queue_type` is null, `reasoning`, or whose `approval_status` is null. Its second update changes null or `reasoning` queue types to `unclassified`.

Consequences:

- A legacy table without `queue_type` receives the new column with the temporary `reasoning` default; existing rows are then quarantined as `unclassified` and `pending`.
- Existing rows explicitly classified into a non-reasoning queue, such as `coding`, retain that queue classification.
- A pre-classified row with a null approval state is retained in its queue but changed to `pending`.
- New rows created after the migration receive `queue_type = 'reasoning'` and `approval_status = 'approved'` unless the caller supplies other values.

This is a fail-closed legacy-row quarantine. It is not a no-data-update migration. Reviewers must assess whether the pending state and worker filters are consistent with the authorization contract before production approval.

## Deliberate exclusions

- No `coding_tasks` table or coding queue lifecycle changes.
- No changes to `PRODUCTION_MIGRATION_ALLOWLIST` or production migration exclusions.
- No production DDL, migration dispatch, deployment, or credential changes.

The existing `20261104120000_isolated_coding_task_queue` migration remains separately gated pending independent review of its classification predicates, target populations, approval evidence, idempotency, lifecycle, and rollback plan.

## Required isolated validation

Run `node scripts/test-agent-runs-runtime-migration-upgrade.mjs` only against a disposable PostgreSQL database whose database name begins with `ryanai_disposable_`, and set `RYANAI_DISPOSABLE_DB=1`. The harness drops and recreates `public.agent_runs`; it refuses to run without both safeguards.

The expanded harness tests:

1. Upgrade from the legacy table shape where `queue_type` and `approval_status` do not exist.
2. Synthetic stale queued, fresh queued, running-lease, completed, and failed rows.
3. Quarantine without rewriting the execution status of running or terminal rows.
4. A bounded, synthetic recovery update that rescues only recent queued rows; stale, running, and terminal rows remain quarantined.
5. The worker-facing queue/approval/status eligibility subset used by the harness.
6. Preservation of an already-classified coding queue row, including a coding row with null approval (which remains pending).
7. Reapplication of the migration and required indexes.

**Important replay behavior:** the migration's DDL is guarded, but its classification DML is not state-idempotent after recovery. Reapplying it will move any rescued `reasoning` row back to `unclassified` / `pending`. Prisma's migration ledger normally prevents an applied migration from being dispatched again; the test makes this behavior explicit so operators do not treat manual SQL replay as harmless.

The recovery statement in the harness is a proposed policy fixture, not a committed production recovery migration or an assertion that a task is safe to execute. It does not check lease expiry, retry eligibility, worker ownership, user authorization, or application-specific approval evidence. A real worker claim/complete test and review of the exact claim SQL remain separate gates.

This focused harness validates the runtime migration contract, not the complete production migration ledger or live Supabase branch. The repository CI runs it against a disposable PostgreSQL service. A separate disposable clone of the exact production ledger is still required for full upgrade and old/new application compatibility testing.

## Review requirements before production approval

1. Confirm the migration against the exact Prisma schema and actual database column/index contract.
2. Complete the focused upgrade/replay harness and full-ledger validation in disposable PostgreSQL.
3. Verify old and new application versions during the migration window.
4. Review worker queue predicates and approval semantics against every fixture class.
5. Validate rollback/recovery strategy and migration lock behavior.
6. Obtain independent human review. Any production allowlist change, production migration, and deployment require separate explicit approval.

This file is review evidence, not authorization to execute the migration.
