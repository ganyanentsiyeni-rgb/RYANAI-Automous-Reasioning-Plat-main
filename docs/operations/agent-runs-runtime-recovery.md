# RyanAI agent-runs schema and operational-awareness recovery

## Scope and safety

This runbook is a read-only diagnosis and verification guide. It does not authorize a production database migration, service restart, Grafana provisioning change, or deployment. Do not use `prisma migrate reset`, `db push`, or an automatic schema synchronizer against production.

## Identified Prisma migrations

The repository's Prisma history contains two relevant migrations:

- `20261105210000_agent_run_trace_context`: adds `agent_runs.trace_context JSONB`.
- `20261108080000_agent_runs_runtime_contract`: adds `trace_context`, `queue_type`, and the execution-scope, approval, plan-binding, cancellation, and queue-index contract.

The second migration is the complete runtime-contract change. Review its entire SQL before any production approval; do not extract only the two missing columns because the worker code expects the broader contract.

## Repository-side compatibility evidence (26 November 2026)

The following checks are based only on committed source at `abcecd9c38787f83abcbd8d12eb754412df80b45`; they are not a live-database attestation:

- `prisma/schema.prisma` defines `AgentRun` with the `public.agent_runs` contract, including `id`, `user_id`, `objective`, execution/approval/plan-binding fields, `queue_type`, worker/lease timestamps, retry fields, and `completed_at`.
- `database.yml` independently declares the operational `agent_runs` columns, including `lease_expires_at`, `heartbeat_at`, `next_attempt_at`, and `completed_at`. The model and YAML agree on the listed required columns at this source revision.
- The migration sequence includes the base table (`20261030120000_agent_operations`), execution scope (`20261102150000_agent_run_execution_scope`), trace context (`20261105210000_agent_run_trace_context`), runtime contract (`20261108080000_agent_runs_runtime_contract`), queue-classification correction (`20261108120000_correct_pending_reasoning_queue_classification`), lease heartbeat (`20261121120000_agent_run_lease_heartbeat`), and fail-closed approval default (`20261122100000_fail_closed_agent_run_approval`).
- The final Prisma model and YAML both require new AgentRuns to remain pending until explicit approval. The later fail-closed migration changes the database default to `pending`; do not rely on the earlier runtime-contract migration's temporary `approved` default as the final contract.
- `20261108080000_agent_runs_runtime_contract` performs data updates as well as additive DDL. Its classification DML is not safe to replay after manual recovery; see `docs/operations/agent-runs-runtime-schema-review.md` for the quarantine and replay consequences.

For compatibility evidence, use the disposable PostgreSQL fresh-install and upgrade jobs in `.github/workflows/database.yml`, plus the guarded migration-upgrade and rollback rehearsals. The repository's `scripts/audit-prisma-migration-readiness.mjs` is read-only but connects to the supplied `DATABASE_URL` to inspect the ledger and schema; run it only against an approved isolated database copy for this review. Never point it or a rehearsal script at the production recovery target. A green, exact-SHA CI run and a separate isolated copy of the exact target ledger are still required before making a production compatibility claim.

## Read-only production checks

Use the configured production connection only from an authorized secure environment. First inspect Prisma's migration state:

```sh
npx prisma migrate status
```

Then inspect the actual schema and migration ledger using read-only SQL:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'agent_runs'
order by ordinal_position;

select migration_name, finished_at, rolled_back_at
from public._prisma_migrations
order by started_at desc;
```

Expected schema includes `trace_context` (jsonb) and `queue_type` (text, not null, default 'reasoning'), plus the other columns in `20261108080000_agent_runs_runtime_contract`.

A missing column or absent migration-ledger entry is a blocker, not evidence that a migration should be applied automatically. The 8 November 2026 inspection recorded 42 local Prisma migrations and 8 finished, non-rolled-back ledger entries; those figures are a dated historical observation, not a current production inventory. On repository `main` at `abcecd9c38787f83abcbd8d12eb754412df80b45` (26 November 2026), the source tree contains 61 primary Prisma migration directories. This is a repository-side count only: no current production `_prisma_migrations` ledger or live schema was queried for this review. Do not infer the number of pending production migrations by subtracting the historical ledger count from the current repository count. Before any production approval, capture the full migration inventory and schema diff from an authorized, isolated copy of the exact target state, assess every pending migration's effects, and obtain separate explicit production-migration approval. Only after approval should an operator apply the approved set using the repository's controlled release process.

## Endpoint verification

Run:

```sh
node scripts/verify-awareness.mjs
```

Optional environment variables:

- `RYANAI_API_URL`: override the endpoint for a staging or local test.
- `RYANAI_API_TOKEN`: bearer token for an endpoint that requires authentication.

The verifier requires HTTP success, an application/json response, the expected source marker, a valid worker state, a numeric report total, and a tasks array. It never prints task payloads or credentials. A 503, HTML login page, malformed JSON, or incomplete payload fails the check.

## Grafana Alloy and alerting

The Alloy configuration probes:

- `https://ryanai-api.onrender.com/health`
- `https://ryanai-api.onrender.com/api/agent/ops/awareness`
- `https://ryanai-web.onrender.com/`

Probes run every 30 seconds and require HTTP 200 with valid TLS. The Grafana alert rule is provisioned separately in `observability/grafana/provisioning/blackbox-alerts.yaml` and fires after one minute of continuous probe failure.

Before provisioning the alert, set `GRAFANA_PROMETHEUS_DATASOURCE_UID` in the Grafana provisioning environment to the actual Prometheus datasource UID. Existing Alloy credentials remain external environment variables; never commit Grafana credentials or API keys.

This repository change only prepares configuration. It does not install or restart Alloy, provision Grafana, create secrets, or verify that remote_write is accepted. Verify the Alloy component health and the incoming `probe_success` and `probe_duration_seconds` series in Grafana after an authorized operator deploys the monitoring configuration.
