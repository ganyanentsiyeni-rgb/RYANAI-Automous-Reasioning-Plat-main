# Studio worker service configuration

Status: staged for review in Railway staging only. No service is live, deployed, or enabled by this change.

## Railway staging worker (staged, not deployed)

A separate `ryanai-studio-worker` service has been staged in the existing Railway `RyanAI` project's `staging` environment only.

- Service ID: `75252a47-db07-4ac6-8966-4d22cdf0897f`
- Environment: `staging` (`418d4fcb-2040-4536-9faf-3c4db7dd9031`)
- Pending patch: `92f78eaa-7645-4cc7-8e51-233bd56b9e64`
- Source: official repository `main`, pinned to `c3e205d3415f6ad447100ac31b41df72f9df2a49` for this staging patch
- Dockerfile: `Dockerfile.api`
- Start command: `node dist/server/server/engineering/studioWorker.js`
- Restart policy: `ON_FAILURE`, up to 10 retries
- Worker gate: `STUDIO_WORKER_ENABLED=false`
- Poll interval: `STUDIO_WORKER_POLL_MS=2500`
- Concurrency: `STUDIO_WORKER_CONCURRENCY=1`

The source, Dockerfile/start command, and non-secret environment settings are pending in one Railway staging patch. It has not been accepted, built, deployed, or enabled. The service must not be staged into production.

Render remains an alternative host, but the existing Render workspace has no worker service and its current service plans are Free. A Render background worker would require paid compute; no upgrade is authorized. The Railway staging path is preferred for validation because the project already has a staging environment.

The Dockerfile default target remains the API image; the worker process is selected by the dedicated service's start command. The API service must keep its own API start command.
Status: prepared for review only. This document does not provision, enable, or deploy a worker.

## Render service contract

The worker is a separate long-running process and must not replace the API process.

- Service type: `worker`
- Runtime: `docker`
- Dockerfile: `./Dockerfile.api`
- Start command: `node dist/server/server/engineering/studioWorker.js`
- Region: Oregon, matching the existing API and Redis placement
- Health check: no HTTP health check; use process exit status and structured worker logs
- Worker gate: `STUDIO_WORKER_ENABLED=false` until a separately approved activation
- Poll interval: `STUDIO_WORKER_POLL_MS=2500`
- Concurrency: `STUDIO_WORKER_CONCURRENCY=1` for initial controlled operation

The Dockerfile must retain a separately addressable `studio-worker` target while the default target remains the API image. The worker start command must not be used as the API service command.

## Required environment

Set these on the worker service independently. Render services do not inherit another service's environment variables.

| Variable | Source / handling |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Copy the verified API database connection through the secret-entry flow; never commit its value |
| `SUPABASE_URL` | Existing Supabase project URL |
| `SUPABASE_SESSION_POOLER_HOST` | Exact host copied from the Supabase Connect panel; do not guess |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret-entry flow only; never commit or print |
| `STUDIO_WORKER_ENABLED` | Keep `false` until explicit production activation approval |
| `STUDIO_WORKER_POLL_MS` | `2500` |
| `STUDIO_WORKER_CONCURRENCY` | `1` |

The worker uses Prisma through the same validated Supabase Session Pooler resolver as the API. It also writes generated Studio plan artifacts to the private `ryanai-studio-artifacts` Supabase Storage bucket. Confirm that bucket and its owner-scoped access policies exist before activation. Do not introduce a second database URL or a guessed pooler hostname.

## Remaining activation blockers

- The staged Railway service is not a live service until the staging patch is explicitly accepted.
- The existing Railway API service's variable-name inventory does not include `SUPABASE_SERVICE_ROLE_KEY`. The worker's artifact storage implementation requires it. Do not invent, copy into source control, or expose this credential; an owner must enter it through Railway's secret UI after verifying the correct Supabase project.
- Confirm the private Supabase Storage bucket `ryanai-studio-artifacts` and its owner-scoped access policies before enabling task execution.
- Verify the staged `DATABASE_URL` and `SUPABASE_URL` references resolve to the intended staging resources.
- Render worker provisioning remains a paid alternative and is not selected.
## Cost and provisioning blocker

Render does not offer a free compute plan for background workers. The existing API and web services are on the Free plan, and no paid upgrade is authorized. Therefore this configuration is intentionally not added to the active `render.yaml`: syncing a worker definition would require selecting paid worker compute and could create billable infrastructure.

Before provisioning, choose an already-authorized compute destination or explicitly approve the required paid worker plan. A Railway staging service exists only as a pending staged-create change; no live service has been created, accepted, or deployed.

## Activation acceptance gates

1. Confirm the worker image builds from the `studio-worker` target and the API image still builds from the default target.
2. Confirm the worker starts with the gate false and performs no queue claims.
3. Verify the database pooler hostname and TLS CA configuration without exposing credentials.
4. Verify the private artifact bucket and owner-scoped storage policies.
5. Run disposable queue tests for competing claims, lease heartbeat, authorization timeout, policy denial, handler failure, retry exhaustion, expired-lease recovery, and completion after lease loss.
6. Confirm exact-head CI/security evidence and human review.
7. Accept the Railway staging patch only after explicit staging-provisioning approval.
8. Production provisioning and worker activation require separate explicit approval.

## Current code-level limitations

- The worker currently registers only the deterministic `studio.plan` task handler.
- The handler creates a plan artifact; it is not a general-purpose agent executor.
- The queue uses PostgreSQL row locks and leases; Redis is not the source of truth for Studio task claims.
- API process health does not prove worker process health. Worker readiness requires a live worker heartbeat or equivalent independently observed process evidence; that shared heartbeat is not currently implemented.
