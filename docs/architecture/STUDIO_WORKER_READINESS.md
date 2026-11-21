# Studio worker liveness and readiness

The Studio worker is a separate process from the RyanAI API. API liveness at
`/health` and API dependency readiness at `/readyz` do not prove that the
Studio worker is running. Build the worker with the dedicated
`Dockerfile.studio-worker`; it has no API HTTP healthcheck and starts the
compiled worker entrypoint by default. CI builds this standalone image without
publishing it.

## Worker heartbeat

When `STUDIO_WORKER_ENABLED=true`, the worker upserts its process heartbeat
into `studio_worker_heartbeats` at startup and every 10 seconds. A graceful
SIGTERM/SIGINT shutdown records `stopped`. The disabled-by-default worker
does not create or refresh a heartbeat and does not claim queued work.

The table stores only a generated worker ID, lifecycle state, timestamps and
non-secret hostname metadata. It contains no credentials, task payloads or
authorization grants. The table is internal; row-level security is enabled
without client policies and client-role table privileges are revoked.

## Readiness endpoint

`GET /studio-worker/readyz` evaluates the latest 50 worker instances:

- `200 healthy`: at least one instance has status `healthy` and a heartbeat
  no older than 30 seconds.
- `503 degraded / missing`: no worker has ever reported a heartbeat.
- `503 degraded / stale`: the most recent worker heartbeat has expired.
- `503 degraded / stopped`: the most recent worker has shut down.
- `503 degraded / starting`: the latest worker has not reported healthy yet.

A fresh heartbeat from any instance wins over stopped or stale records from
other instances. The endpoint is independent of `/health` and `/readyz`;
worker absence must not make API liveness fail or trigger an API restart.

## Acceptance

1. Apply the additive migration only to an isolated staging/test database.
2. Generate the Prisma client from the updated schema.
3. Run readiness unit tests and the disabled-worker integration test.
4. Confirm `/health` stays live while `/studio-worker/readyz` reports missing
   when no worker is enabled.
5. In an explicitly authorized staging session, enable one worker and verify
   fresh heartbeat, stale detection, and graceful stopped state.
6. Keep the worker disabled until staging acceptance is explicitly approved.

No production migration, service activation or deployment is authorized by
this change.
