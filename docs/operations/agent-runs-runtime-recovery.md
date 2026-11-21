# RyanAI agent-runs schema and operational-awareness recovery

## Scope and safety

This runbook is a read-only diagnosis and verification guide. It does not authorize a production database migration, service restart, Grafana provisioning change, or deployment. Do not use `prisma migrate reset`, `db push`, or an automatic schema synchronizer against production.

## Identified Prisma migrations

The repository's Prisma history contains two relevant migrations:

- `20261105210000_agent_run_trace_context`: adds `agent_runs.trace_context JSONB`.
- `20261108080000_agent_runs_runtime_contract`: adds `trace_context`, `queue_type`, and the execution-scope, approval, plan-binding, cancellation, and queue-index contract.

The second migration is the complete runtime-contract change. Review its entire SQL before any production approval; do not extract only the two missing columns because the worker code expects the broader contract.

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

A missing column or absent migration-ledger entry is a blocker, not evidence that a migration should be applied automatically. The current repository contains 42 Prisma migration SQL files, while the live Prisma ledger currently records 8 finished, non-rolled-back entries. Therefore, `npx prisma migrate deploy` could apply multiple pending migrations, not just the agent-runs repair. Do not run it until the complete pending migration inventory and ordering have been reviewed. Capture the full migration diff, assess every pending migration's effects, and obtain explicit production-migration approval separately. Only after approval should an operator apply the approved set using the repository's controlled release process.

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
