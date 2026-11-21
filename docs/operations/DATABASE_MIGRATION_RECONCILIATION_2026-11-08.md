# RyanAI migration reconciliation — 8 November 2026

## Scope and safety

This is a read-only reconciliation of the live Supabase and Prisma migration ledgers, the repository migration files on `main` at the time of inspection, and live schema catalog metadata. It does not alter either ledger or any database object. No application rows were read.

Live project: `narsvpwymvlrhurqbthu`.

Repository baseline inspected: `main` at `1c7656c4c6e914e66aba2491c5c5405e5a1e7a33`.

At that baseline there were 42 Prisma migration directories and 19 Supabase migration SQL files (61 migrations total). `supabase/migrations/seed.sql` is a separate seed script and is not counted as a migration.

Status meanings:
- **Prisma ledger** — exact migration name is present in `public._prisma_migrations`, finished, not rolled back.
- **Supabase alias** — a semantically corresponding entry is present in `supabase_migrations.schema_migrations`, but it is under a different version/name and is not proof that the repository file's exact DDL/checksum ran.
- **Supabase ledger** — exact Supabase migration version is present.
- **Absent** — no matching record was found in either live ledger.
- **Ambiguous** — a likely ledger entry exists, but its applied SQL cannot be proven equivalent from ledger metadata alone.

## A. Prisma migration-by-migration map (42 files)

| Repository Prisma migration | Live-ledger mapping | Finding |
|---|---|---|
| `20261014000000_supabase_platform_baseline` | No matching Prisma record. Supabase has `20261102105124_prisma_migration_ledger_baseline`. | **Baseline mismatch.** The required no-op Prisma marker is absent from `_prisma_migrations`; a similarly named record in the other ledger is not equivalent. |
| `20261015081513_init_reasoning_platform` | Prisma exact record; Supabase alias `20261102104245_ryanai_init_reasoning_platform`. | Recorded in both ledgers under different histories. Compare effects; do not repair by timestamp. |
| `20261030120000_agent_operations` | Prisma exact record; Supabase alias `20261102104250_ryanai_agent_operations`. | Duplicate ownership/history entry. |
| `20261030130000_brain_knowledge` | Prisma exact record; Supabase alias `20261102104255_ryanai_brain_knowledge`. | Duplicate ownership/history entry. |
| `20261030130500_agent_task_queue` | Prisma exact record; Supabase alias `20261102104300_ryanai_agent_task_queue`. | Duplicate ownership/history entry. |
| `20261030153000_agent_run_retry_backoff` | Prisma exact record; Supabase alias `20261102104305_ryanai_agent_run_retry_backoff`. | Duplicate ownership/history entry. |
| `20261101110000_communications_and_langgraph_checkpoint` | Prisma exact record; Supabase alias `20261102104310_ryanai_communications_langgraph_checkpoint`. | Duplicate ownership/history entry. |
| `20261101111500_complete_supabase_models` | Prisma exact record; Supabase alias `20261102104315_ryanai_complete_supabase_models`. | Duplicate ownership/history entry. |
| `20261102123000_supabase_auth_identity_bridge` | Prisma exact record; Supabase alias `20261102104357_supabase_auth_identity_bridge`. | Duplicate ownership/history entry. |
| `20261102150000_agent_run_execution_scope` | None. | Absent from both ledgers. |
| `20261102210000_internal_jarvis_audit` | None. | Absent from both ledgers. |
| `20261102235000_engineering_evidence_workbench` | None. | Absent from both ledgers. |
| `20261104100000_vector_memory` | Supabase alias `20261102104421_ryanai_vector_memory`; no Prisma record. | Vector-memory DDL appears recorded under the Supabase ledger rather than its Prisma owner. Live vector objects require effect-level comparison. |
| `20261104120000_agent_memory_session_id` | None. | Absent from both ledgers. |
| `20261104120000_isolated_coding_task_queue` | None. | Absent from both ledgers; live `agent_runs` lacks queue fields and `coding_tasks` is absent. |
| `20261104190000_quant_experiments` | None. | Absent from both ledgers. |
| `20261104200000_audiobook_persistence_jobs` | None. | Absent from both ledgers. |
| `20261104203000_audiobook_render_request_snapshot` | None. | Absent from both ledgers. |
| `20261104210000_audiobook_active_render_guard` | None. | Absent from both ledgers. |
| `20261105120000_comms_outbound_idempotency` | Supabase mirror `20261107150000_comms_outbound_idempotency` is recorded; no Prisma record. | The two repository migrations add the same nullable idempotency key and unique index. Despite the Supabase ledger record, live `communication_messages.idempotency_key` is absent: ledger/schema inconsistency requiring investigation. |
| `20261105130000_comms_secure_attachments` | None. | Absent from both ledgers. Its Supabase counterpart is also not recorded. |
| `20261105143000_quant_paper_trading` | None. | Absent from both ledgers. |
| `20261105150000_quant_paper_risk_policies` | None. | Absent from both ledgers. |
| `20261105160000_quant_paper_strategies` | None. | Absent from both ledgers. |
| `20261105170000_quant_market_data_imports` | None. | Absent from both ledgers. |
| `20261105180000_quant_strategy_signals` | None. | Absent from both ledgers. |
| `20261105182000_quant_private_table_isolation` | None. | Absent from both ledgers. |
| `20261105190000_quant_paper_daily_risk_controls` | None. | Absent from both ledgers. |
| `20261105200000_github_app_oauth` | None. | Absent from both ledgers. |
| `20261105200000_quant_risk_state_private_access` | None. | Absent from both ledgers. |
| `20261105210000_agent_run_trace_context` | None. | Absent from both ledgers. |
| `20261105210000_pa_delegation` | None. | Absent from both ledgers. |
| `20261105210000_quant_paper_order_proposals` | None. | Absent from both ledgers. |
| `20261105211000_quant_paper_proposal_confirmation_state` | None. | Absent from both ledgers. |
| `20261105223000_quant_market_data_events` | None. | Absent from both ledgers. |
| `20261105224500_quant_market_data_events_rls` | None. | Absent from both ledgers. |
| `20261105233000_quant_paper_fill_reconciliation` | None. | Absent from both ledgers. |
| `20261106000000_security_centre_core` | None. | Absent from both ledgers. |
| `20261107100000_plugin_provider_authorization` | None. | Absent from both ledgers. |
| `20261107160000_agent_requested_model` | Supabase alias `20261108070252_agent_requested_model`; no Prisma record. | Live `agent_runs.requested_model` exists, but the Prisma migration is not recorded in the Prisma ledger. |
| `20261108010000_studio_native_core` | None. | Absent from both ledgers; Studio tables are absent from the live catalog. |
| `20261108080000_agent_runs_runtime_contract` | None. | Absent from both ledgers; runtime queue/approval columns are absent from the live catalog. |

All eight rows in the live Prisma ledger are finished, not rolled back, and have `applied_steps_count = 1`. The ledger contains only the eight exact records listed above; it does not contain the baseline marker or any later Prisma migration.

## B. Supabase migration-by-migration map (19 files)

| Repository Supabase migration | Live-ledger mapping | Finding |
|---|---|---|
| `20260908093451_create_profile_and_conversations.sql` | Exact record `20260908093451_create_profile_and_conversations`. | Recorded. Core Auth/chat objects exist in the live catalog. |
| `20261030120000_private_conversation_attachments.sql` | Alias `20261102104502_private_conversation_attachments`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261030130000_attachment_quota_enforcement.sql` | Alias `20261102104508_attachment_quota_enforcement`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261030140000_attachment_malware_scan_quarantine.sql` | Alias `20261102104515_attachment_malware_scan_quarantine`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261031100000_attachment_quarantine_retention.sql` | Alias `20261102104520_attachment_quarantine_retention`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261031110000_attachment_orphan_cleanup.sql` | Alias `20261102104525_attachment_orphan_cleanup`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261031120000_attachment_message_path_guard.sql` | Alias `20261102104530_attachment_message_path_guard`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261031130000_attachment_update_guard.sql` | Alias `20261102104538_attachment_update_guard`. | Renumbered/renamed ledger entry; compare exact DDL. |
| `20261031150000_least_privilege_public_grants.sql` | Possible relation to `20261102104233_harden_public_privileges_postgres_managed_role` or `20261102104608_finalize_ryanai_public_privileges`. | **Ambiguous.** Both ledger entries are privilege-related; ledger metadata alone cannot prove which file/effects they represent. |
| `20261102110000_harden_supabase_public_privileges.sql` | Likely alias `20261102104233_harden_public_privileges_postgres_managed_role`. | Semantic match, but exact SQL/checksum equivalence is not available from the ledger. |
| `20261105130000_comms_secure_attachments.sql` | None. | Absent from both ledgers. The corresponding Prisma migration is also absent from the Prisma ledger. |
| `20261105193000_attachment_signed_upload_reservations.sql` | None. | Absent from both ledgers. |
| `20261107150000_comms_outbound_idempotency.sql` | Exact record `20261107150000_comms_outbound_idempotency`. | Ledger says applied, but live `communication_messages.idempotency_key` and its unique index were not found. Treat as a ledger/schema discrepancy, not a successful migration. |
| `202611080001_phonelink_device_registry.sql` | None. | Absent from both ledgers. |
| `20261108020000_studio_artifact_storage.sql` | None. | Absent from both ledgers. |
| `20261108090000_comms_attachment_scan_bucket.sql` | None. | Absent from both ledgers. |
| `20261108110000_studio_worker_heartbeats.sql` | None. | Absent from both ledgers; live heartbeat table is absent. |
| `20261108195000_community_feedback_submissions.sql` | None. | Absent from both ledgers; live survey submissions table is absent. |
| `99999999999999_post_grants.sql` | Possible relation to `20261102104608_finalize_ryanai_public_privileges`. | **Ambiguous.** Confirm exact grants and default ACL effects before mapping. |

## C. Unmatched Supabase ledger records

| Live Supabase ledger record | Repository match | Disposition |
|---|---|---|
| `20261102105124_prisma_migration_ledger_baseline` | No exact Supabase file. Related concept: Prisma marker `20261014000000_supabase_platform_baseline`. | Wrong-ledger baseline discrepancy. Do not treat it as the required Prisma marker. |
| `20261107184458_ensure_rls_auto_enable_public_tables` | No matching repository migration file in the 19-file Supabase chain. | Source migration is missing or was applied externally; obtain the original SQL and provenance. |
| `20261102104608_finalize_ryanai_public_privileges` | Possibly `99999999999999_post_grants.sql` or `20261031150000_least_privilege_public_grants.sql`. | Keep ambiguous until exact SQL effects can be reconciled. |

The remaining Supabase ledger entries are the seven attachment aliases, the initial Auth/chat migration, the hardening privilege alias, the eight Prisma aliases listed in section A, the vector-memory alias, and the requested-model record. This explains why the two ledgers cannot be compared by raw counts or timestamps alone.

## D. Live schema evidence and material gaps

Catalog inspection confirmed:
- `public.agent_runs.requested_model` exists.
- `agent_runs.queue_type`, `approval_status`, `plan_snapshot`, and `proposed_diff_hash` are absent.
- `public.coding_tasks` and `public.agent_run_evidence` are absent.
- `communication_messages.idempotency_key` is absent despite the Supabase ledger entry.
- `community_feedback_submissions`, Studio tables, Quant tables, Security tables, and Plugin Provider tables are absent.
- Legacy shared-room tables `rooms`, `room_members`, and `room_messages` exist in the supplied schema snapshot and live catalog; they were not represented in the repository's Prisma model or migration ownership documentation before the repair branch changes. The supplied snapshot lists columns and primary keys but not FK/index/default/policy definitions. The branch intentionally mirrors only verified columns and primary keys, enables RLS without recreating unknown policies, and records policy/function recovery as a functional blocker.
- The live catalog includes attachment scan and upload-event tables. These do not prove that all later attachment reservation, Comms, or Storage migrations are present.

## E. Paper-only ownership and baseline decisions

1. Keep Supabase CLI as owner of Auth-linked profiles/chat/shared-room objects, Storage buckets, RLS policies, helper functions, and browser grants.
2. Keep Prisma as owner of RyanAI application tables and runtime/business schema.
3. Where Supabase-owned tables are mirrored in `prisma/schema.prisma`, use an idempotent Prisma compatibility migration for Prisma-only disposable installs. In the combined Supabase + Prisma path, Supabase creates those tables first; Prisma must not replace Supabase RLS or Storage ownership.
4. The `20261014000000_supabase_platform_baseline` Prisma migration is a no-op marker. It belongs in `_prisma_migrations` after local Supabase reset and before Prisma application migrations. The similarly named Supabase ledger record does not satisfy this requirement.
5. Do not run `prisma migrate resolve`, `supabase migration repair`, `supabase db push`, or any production migration to make the ledgers appear aligned. First prove DDL equivalence and live schema state; record a separate human-approved repair plan.

## F. Queue classification impact

The original coding-queue migration uses `approval_status = 'pending'` as one of the conditions for `queue_type = 'coding'`. That is too broad: pending approval is a governance state, not proof of coding-workbench intent. The runtime-contract migration preserves rows already classified as `coding`, so it does not undo that earlier classification.

The repair branch therefore preserves the original migration checksum and adds a later, additive correction migration. It reclassifies only rows that are currently `coding`, still pending, and have neither `plan_snapshot` nor `proposed_diff_hash` to `unclassified`. The disposable fixture checks:
- ordinary pending reasoning with no plan/diff evidence becomes `unclassified`;
- pending workbench with explicit plan evidence remains `coding`;
- plan-bound and diff-bound workbench rows remain `coding`.

No production row update was run.

## G. Current approval gates

| Stage | Status |
|---|---|
| Migration inventory and first-pass ledger mapping | **Completed with explicit ambiguous mappings** |
| Ownership and baseline decisions on paper | **Documented; no ledger changes** |
| Queue classification review and fixture changes | **Implemented on repair branch; not executed** |
| Full Supabase + Prisma replay on disposable database | **Triggered, queued** — draft PR #1397 triggered the database workflow, Supabase migration replay, and staging Prisma replay. At observed head `39dfec935116c09cda47bec30abec36766af76b6`, all three runs were queued; no test result is yet available. Any later branch commit requires fresh exact-head verification. |
| Data-impact, compatibility and recovery report | **This document is the preliminary report; independent human approval is still required** |
| Production migration or deployment | **Not authorized; not performed** |

This document is not a production migration approval. Before any production action, an independent reviewer must approve the exact migration head, both ledger mappings, schema diff, queue-row reclassification counts, backup/recovery plan, and tested rollback/forward-repair procedure.

## H. Data-impact assessment

No application rows were queried, so affected-row counts and data distributions are **unknown**. The following are effects inferred from the reviewed migration SQL, not measured production outcomes.

| Change family | Data/schema effect | Risk and required evidence |
|---|---|---|
| Prisma platform baseline | No schema or row DDL; initializes only the Prisma migration ledger when run after Supabase reset. | Wrong-ledger recording can make Prisma's first application migration fail with P3005 or create a false history. Confirm target database is a disposable Supabase reset before recording. |
| Auth identity bridge | Creates/updates the server-only `users` shadow from `auth.users`; password hashes remain NULL for Supabase identities. | Identity backfill/update is row-affecting. Compare Auth/user counts and identity keys; do not copy credentials. |
| Queue and runtime contract | Adds runtime/approval/queue columns and indexes; reclassifies legacy runs. The runtime contract sets non-running reasoning work to pending/unclassified while preserving running rows with worker/lock evidence. | **High data-impact.** Capture counts by status, queue_type, approval_status, worker_id and locked_at before/after in disposable replay. Confirm no active lease is stranded. Never infer success from column presence alone. |
| Coding-task queue | Creates `coding_tasks` and indexes/FKs; the original migration classified pending rows as coding even without workbench evidence. The branch correction reclassifies only pending coding rows without plan/diff evidence to unclassified. | Verify the exact before/after classification matrix and task ownership/FKs. The correction must not move pending runs with explicit plan/diff evidence out of coding. |
| Comms idempotency | Adds nullable `idempotency_key` and a unique index in both Prisma and Supabase chains. | No backfill in reviewed SQL. Validate the two migration owners do not conflict and test duplicate non-null keys on a disposable DB. Live column is absent and neither matching migration is recorded in the correct ledger. |
| Attachments and Storage | Creates or hardens private buckets, metadata, scan/quarantine state, upload reservations, triggers, quota/path checks and cleanup functions. | Potentially changes Storage behavior and access. Verify bucket privacy, existing object paths, ownership references, trigger behavior, quota accounting and scanner queue state. Do not purge or resend objects during validation. |
| Shared rooms | Creates tables and indexes on a fresh database; installs/replaces member/owner helper functions and seven RLS policies. On an existing database, `CREATE TABLE IF NOT EXISTS` leaves existing table definitions intact while policies/functions are recreated. | Confirm current constraints/indexes match the inspected catalog; validate owner/member access using disposable Auth identities and negative cross-user tests. |
| Quant, Security, Plugin, Studio, Community Survey | Predominantly additive tables, indexes, constraints and policies; no production rows are copied by the reviewed creation migrations. | Validate all DDL, RLS, FKs, uniqueness and storage contracts in a disposable database. Survey notification delivery must remain stubbed; no live email is authorized. |
| Seed | `seed.sql` is comment-only and inserts no default records or broad grants. | Keep it empty of credentials, real users, test messages or blanket grants. |

The live schema catalog already contains `requested_model`, the attachment scan tables, and the shared-room tables. It does not contain the runtime queue fields, `coding_tasks`, the Community Survey submissions table, Studio worker heartbeat table, or Comms idempotency column. These are schema facts only; no application rows were read.

## I. Compatibility and recovery requirements

### Compatibility checks required before approval

1. Replay all Supabase migrations from an empty disposable local Supabase stack, including the configured comment-only seed.
2. On that same disposable database, record only the Prisma no-op platform marker, then replay every Prisma application migration in order.
3. Replay the standalone Prisma-only install separately using the disposable Auth compatibility fixture.
4. Run Prisma validation, generate both Prisma clients, compare the resulting database to `prisma/schema.prisma`, and run Prisma deploy a second time.
5. Verify both migration ledgers independently. The baseline marker must be in `_prisma_migrations`, never inferred from a similarly named Supabase ledger row.
6. Verify room tables, room RLS enablement, helper-function grants, attachment policies/storage buckets, communication idempotency, queue fixtures, Studio/Survey schema and the schema audit.
7. Keep all outbound communications mocked/stubbed. No live recipient, provider callback, email, WhatsApp, SMS or voice dispatch is part of this database validation.

### Recovery plan required for independent approval

- Take and verify a restorable database backup/point-in-time recovery position before any production migration is considered. Record backup timestamp, target project/branch, restore owner and a tested restore procedure.
- Preserve copies of both migration ledgers and a schema-only catalog snapshot before any change. Record exact repository commit, migration checksums, database identity and migration runner version.
- In the disposable replay, capture pre/post row counts and classification counts for `agent_runs`, Auth identity-shadow counts, attachment metadata/object counts, and relevant unique/FK violations. Do not export message bodies, credentials or other unnecessary personal content.
- For queue changes, retain a deterministic before/after sample of fixture IDs and aggregate counts. Verify that running leases with both worker ID and lock timestamp remain protected, and that ordinary pending reasoning cannot enter the coding queue.
- If a production migration later fails, stop further migration attempts and worker claims; capture the exact failing statement, current transaction/ledger state and logs. Do not run `migration repair`, `migrate resolve`, or replay non-idempotent DML as an improvised recovery.
- Prefer a reviewed forward-repair migration when the database has partially advanced. Use point-in-time restore only when the approved recovery plan establishes that the resulting data loss is acceptable and the restore has been tested.
- The runtime-contract migration is not safe to blindly replay as a recovery action: its classification DML can re-quarantine reasoning work that an operator has deliberately rescued. A retry requires a new state-aware recovery procedure.
- Keep production migration and production deployment as separate approvals. A successful disposable replay does not authorize either action.

## J. Repair-branch delta and evidence

Repair branch: `repair/queue-classification-pending-reasoning-20261108`.

The branch head is expected to advance as review fixes are made; independently re-check the exact SHA and status immediately before approval.

The branch adds two Prisma migrations (shared-room compatibility and pending-reasoning correction) and one Supabase migration (shared-room tables with RLS enabled; exact policies remain a blocker). Its inventory is therefore 44 Prisma migrations plus 20 Supabase migration files, 64 migrations total; `seed.sql` remains a separate seed script. It also updates `prisma/schema.prisma`, Supabase seed configuration, post-grants, read-only schema audit/tests, database workflow assertions, package scripts, ownership documentation and this reconciliation report.

Draft PR #1397 was opened specifically to trigger pull-request validation. At observed head `39dfec935116c09cda47bec30abec36766af76b6`, 28 pull-request or PR-associated workflow runs were registered: 21 queued, 5 pending, and 2 skipped. The critical runs were Database Schema Validation (`42521279487`), Supabase Migration Replay (`42521279559`), and Staging Prisma Migration Validation (`42521279554`); all were queued at the last check. The Human PR Approval Gate was skipped because the PR is draft. This is **queued/missing CI evidence**, not a pass. No workflow dispatch, disposable database completion, PR review, merge, production migration or deployment has been confirmed.

Independent human approval remains outstanding. Production migrations, ledger edits, deployments, secrets changes and live notifications remain unauthorized.


## G. Disposable replay findings — 9 November 2026

The first exact-head replay reached the migration and restart-safety assertions successfully but exposed three independent validation defects:

1. **CI environment defect — fixed on the repair branch.** The database workflow's `db:validate` step validates the isolated audiobook Prisma schema, but the job-level environment did not define `AUDIOBOOK_DATABASE_URL_UNPOOLED`. The repair branch now supplies both disposable audiobook URLs at job scope. This is CI-only configuration and contains no production credential.

2. **Supabase Auth cross-schema contract — fixed on the repair branch.** The combined fresh-stack replay completed the Supabase and Prisma migration ledgers and restart-safe deploy, then `prisma migrate diff` failed with P4002 because `public.conversations` references `auth.users`. The Prisma datasource now explicitly declares `schemas = ["public", "auth"]`. This does not create or modify `auth.users`; it tells Prisma that the existing Supabase Auth schema is part of the disposable introspection contract.

3. **Prisma schema/model drift — partially classified and repaired on the branch.**
   - **Genuine Prisma contract gap:** the six Quant paper tables (`quant_paper_positions`, `quant_paper_orders`, `quant_paper_trades`, `quant_paper_risk_policies`, `quant_paper_strategies`, `quant_paper_portfolio_risk_state`) were created by Prisma migrations and are actively used by server routes, but were absent from `prisma/schema.prisma`. The branch adds typed Prisma models and their verified relations/constraints.
   - **Genuine compatibility gap:** `studio_worker_heartbeats` is represented in `prisma/schema.prisma` and actively used by the server, but its table was only provisioned by the Supabase migration. A new Prisma-only compatibility migration was added so disposable Prisma installs have the same table contract. This increases the Prisma chain from 44 to **45** migrations; the replay workflow count is updated accordingly rather than pretending the chain is still 44.
   - **Harmless representation difference:** generated UUID defaults were normalized from `gen_random_uuid()::text` to Prisma's introspected `(gen_random_uuid())::text` representation.
   - **Verified shared-room mismatch:** `room_messages.id` and `room_messages.created_at` previously had Prisma defaults that were not present in the supplied live schema snapshot. The branch removes those defaults and keeps only the verified columns/primary key.
   - **External/ownership differences:** several foreign-key/index changes involve Supabase-owned/shared objects or naming representations. These are not being suppressed; they remain subject to the final replay diff and effect-level review.

The initial exact-head CI evidence was:
- Database Schema Validation: **failed** at Prisma schema validation before the database diff because of the missing audiobook URL.
- Supabase/Prisma fresh-stack validation: **passed migration replay and second deploy**, then **failed only at cross-schema Prisma diff** with P4002.
- Ephemeral PostgreSQL dry-run: migrations applied, then **failed schema reconciliation** on the drift listed above.

No production database, migration ledger, deployment, secret, or live notification was modified.

## H. Updated acceptance gate

Because the repair necessarily adds the missing Studio-worker Prisma compatibility migration, the final disposable acceptance gate is now:

**45/45 Prisma migrations applied → second Prisma deploy is a no-op → Prisma schema reconciliation clean → Supabase + Prisma fresh-stack replay clean → queue upgrade fixtures pass → migration audit clean.**

The original 44-migration replay remains useful evidence: all 44 pre-existing migrations completed successfully before the compatibility correction was added. The 45th migration is a targeted compatibility repair, not a production migration.

Human review remains required before any production migration or deployment.
