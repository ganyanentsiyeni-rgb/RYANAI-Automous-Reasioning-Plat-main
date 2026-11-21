# RyanAI Studio Native Core

## Ownership model

Studio owns its own project, task, artifact and lifecycle-event records. The legacy AgentRun/Jarvis intake remains available as a compatibility path, but the native API is separate and does not dispatch through Jarvis.

## Shipped in this increment

- Native project records with owner scoping, project types, lifecycle status and metadata, exposed in a new mobile-friendly Native Project Foundry and project list in Studio.
- Durable Studio task graph with dependency IDs, capability requirements, assignment hints, priorities, idempotency key, retry budget and approval state.
- Dependency-cycle validation at project creation.
- PostgreSQL task claiming using `FOR UPDATE SKIP LOCKED`, lease owner, expiry and heartbeat.
- Expired lease recovery with bounded retry/backoff and terminal failure after the retry budget.
- Specialist assignment hints based on the canonical workforce roster. This is a recommendation, not proof of live availability.
- Worker handler registry and a worker-once execution contract with lease heartbeat/fencing. A handler cannot run until the supplied Gen-X policy callback allows it.
- Artifact metadata with storage reference, checksum and provenance. This increment does not create or expose storage credentials.
- Append-only project/task lifecycle events and a delivery-readiness endpoint.
- A fail-closed plugin capability gateway contract requiring declared capability, opaque server-side connection reference, Gen-X policy decision, matching human approval for write/outbound/destructive actions, and audit callback.
- Studio UI status distinguishes native lifecycle/scheduler foundations from a worker runtime that is not yet configured.

## API

- `GET /api/engineering/studio/native/projects` — signed-in owner's projects, tasks and artifacts.
- `POST /api/engineering/studio/native/projects` — create a Studio-owned project and optional dependency graph.
- `GET /api/engineering/studio/native/projects/:projectId/delivery` — owner-scoped delivery readiness and human-review requirement.

These APIs are authenticated with the existing `requireUser` hook. The older `/api/engineering/studio/projects` endpoint remains the legacy AgentRun/Jarvis compatibility path.

## Important limitations

- The API and worker are separate processes. The worker entry point and a `studio-worker` Docker build target are included in the follow-up increment; no host service is provisioned or deployed by the PR. The worker remains disabled unless `STUDIO_WORKER_ENABLED=true`, and its built-in `studio.plan` handler requires the real Gen-X decision plus a recorded owner approval.
- The plugin gateway is a server-side contract only. No provider adapter is activated and no new HTTP tool-execution endpoint is exposed.
- Artifact records contain storage metadata and provenance; a storage provider integration and signed upload/download workflow remain separate work.
- Delivery readiness is an evidence summary, not release approval. Human review remains mandatory.
- The migration is included for review only. It has not been applied to production or any connected database.

## Next implementation milestones

1. Host-integrated native worker service with heartbeat loop, bounded concurrency, shutdown handling and Gen-X policy adapter.
2. Workforce availability heartbeats, capacity-aware assignment and explicit reassignment controls.
3. Approved object-storage adapter, artifact upload/download UI, checksum verification and retention controls.
4. Provider-specific plugin adapters behind the fail-closed gateway and connection-vault resolver.
5. Task graph visualizer, project Foundry UI, artifact browser and quality gate board.
6. End-to-end integration tests using an isolated disposable Postgres database; no production migration or execution as part of test setup.
7. Delivery package generation with reproducible test/security evidence and explicit human sign-off.

## Safety invariants

- Gen-X remains the sole authorization authority.
- No default-allow policy callback exists; missing policy integration means no worker execution.
- No provider execution route or raw credential path is exposed.
- Write, outbound and destructive tool capabilities require matching human approval.
- Queue lease/worker completion is not verification or release approval.
- No production deploy, database migration, secrets modification, paid upgrade, external dispatch, auto-merge or production execution is performed by this change.
