# RyanAI Patch Record — Shared PA / Darkside / Comms / Push Deploy

**Status:** implementation record for the focused repair branch. This document records intended and implemented contract changes; it is not a deployment certification.

## 1. Scope

This patch aligns four connected responsibilities:

- **PA Agent** — governed task execution and deployment orchestration.
- **Darkside Copilot** — shared operator surface using the same PA capability model.
- **Admin Console** — administrative access to the shared PA control plane.
- **Comms** — durable internal child-task reporting from PA objectives.

## 2. Deployment contract

The release path is:

**exact candidate SHA → exact-SHA CI/CD + security gate → explicit PUSH DEPLOY → Render + Railway + Vercel independent jobs → per-provider deployment evidence → per-provider health verification → durable internal Comms report.**

A provider failure does not silently prevent the other provider jobs from being attempted.

A PA deployment receipt is only workflow-dispatch acceptance. It is not evidence that CI passed, a provider deployed, or runtime health passed.

## 3. Authorization

- UI capability selection is not authorization.
- Gen-X remains the authorization authority.
- deployment.execute is a governed capability.
- Deployment requests must include comms.task.create so the result can be reported internally.
- The explicit PUSH DEPLOY phrase is required for deployment requests.
- The fixed workflow validates the current main SHA and all required exact-SHA checks.
- No secret creation, rotation, or exposure is performed by this patch.
- No database migration is performed by Push Deploy.

## 4. Comms contract

A PA objective can create a durable internal Comms child task directly; an existing Comms conversation is not required.

The child is owner-scoped, idempotent, linked to the parent task, and internal-only. It does not send WhatsApp, SMS, voice, or email.

Future routing tags:

@RyanAI @PA Agents @Comms @Security @updates @self-patches

are routing metadata only. They are not authorization and must not bypass the explicit release gate.

## 5. Verification requirements

Before merge, record:

- exact branch/head SHA;
- CI typecheck/lint/test/build results;
- security scan results;
- workflow validation;
- PA capability/Gen-X tests;
- Comms child-task tests;
- deployment workflow validation;
- review result.

Do not convert queued, skipped, cancelled, missing, stale, or provider-blocked checks into a pass.

## 6. Deployment boundary

This patch does **not** trigger production deployment. Production deployment still requires the explicit Push Deploy action after the required exact-SHA checks pass.

## 7. AI Inspector module and worker handler coverage

- Added a dedicated `ai-inspector-module-agent` module owner with `ai-inspector.audit` and `ai-inspector.report` routing.
- Routed those task types to the repository-auditor profile, with read-repository capability checks and report output persisted through the Studio task completion boundary.
- Added bounded read-only specialist handlers for coordinator, security, runtime/infrastructure, data/queue, provider configuration, communications/identity, frontend/accessibility, and release readiness. The existing repository inventory and CI diagnostics handlers remain distinct.
- Unified CI diagnostics task-handler registration across both Studio worker entrypoints; `ci-failure`, `test-failure`, and `build-failure` now share the same tested registration boundary. Replaced a fake handler-registration test with real readiness coverage for all ten worker profiles.

- Updated the AI Inspector workflow to run the audit with `--write`, creating the report path that the artifact-upload step expects.
- Added registry and handler-readiness regression tests. These validate registration, not deployed/live heartbeats.
- No production deployment, database migration, secret change, auto-merge, or external message delivery.

## 8. Backend handler integrity repair

- Repaired the malformed specialist handler module introduced by overlapping edits: removed duplicate/truncated declarations and restored one complete static inspection and AI Inspector execution path.
- Preserved the dedicated AI Inspector module owner and PA direct inspection capability; specialist worker registration now exposes `ai-inspector.audit` and `ai-inspector.report` without replacing or double-registering repository inventory handlers.
- Bounded repository evidence traversal by root path, depth, file count, and file size; added cancellation checks and read-only behavior.
- Preserved high-severity AI Inspector findings for PA with report digest/source/exit-code evidence. Exit code 1 means findings exist; it must not discard the report or falsely claim a clean audit.
- Added a regression test for PA report delivery, alongside handler registration/routing tests.
- No deployment, migration, secret changes, paid upgrade, auto-merge, or outbound communications.

## 9. Studio worker lifecycle and lease regression fixtures

- Updated the concurrent-stop test to wait for the actual terminal-heartbeat boundary before asserting that only one shutdown drain is active.
- Made terminal-heartbeat failure injection conditional on the `stopped` status, so background healthy heartbeats cannot consume the intended shutdown failure.
- Aligned queue test query fixtures with the current terminal-dependency sweep, claim query, and token-fenced authorization re-check.
- Kept the production lease/authorization logic unchanged; these changes repair stale test assumptions and preserve the existing Gen-X and lease-token fences.
## AI Inspector module and PA report skills

- Allocated the dedicated `ai-inspector-module-agent` as the 13th module identity, with bounded read/inspect/test/evidence/patch-proposal actions and no privileged execution authority.
- Expanded its inspection path to combine `scripts/ai-inspector-audit.mjs` with bounded cross-module source inspection for agent orchestration, backend integrations, provider adapters, queue/lease contracts, infrastructure, CI workflows, and release documentation.
- PA receives structured findings, severity/rule IDs, evidence-file references, source metadata, report text, and a digest through durable AgentRun evidence. Exit code 1 retains high-severity findings for triage; it is not misreported as a clean audit.
- Corrected the pg-dump connection test contract to use Node's native test runner and excluded that file from Vitest discovery; CI continues to execute it explicitly with `node --test`.
- No secrets were changed, no production migration/deployment occurred, and no external communication was sent.

## Complete worker handler readiness

- Tightened worker readiness: a profile is ready only when every task type in its roster has a registered handler in that process; partial registration is now reported with the exact missing task types.
- Kept coordinator task ownership singular: the shared specialist registrar owns planning/triage, while each worker bootstrap owns its coordination task implementation, avoiding duplicate registration in the server worker path.
- Added bootstrap contract coverage for the repository inventory and CI diagnostic task handlers and a regression test proving partial registration cannot be marked ready.

## Worker inventory TypeScript build repair

- Fixed the exact-head `TS5055` failure caused by importing `scripts/repository-inventory.mjs` into the server TypeScript build.
- Moved the bounded read-only inventory handler into `ryanaiSpecialistTaskHandlers.ts`, shared by server and CLI worker profiles; the standalone Node inventory utility remains independent.
- Removed duplicate/incomplete coordinator registration in the CLI worker bootstrap and centralized repository-auditor task registration.
- Fixed duplicate specialist registration in the workforce tests and added explicit inventory output/capability tests.
- Corrected PA objective newline serialization so internal Comms tasks and memory context receive real line breaks.


## Authenticated provider health

- Added a server-only authenticated provider health probe service for Google Calendar, Gmail, and Microsoft 365 Calendar.
- Added owner-scoped `GET /api/plugins/:provider/health` with server-side credential resolution, bounded HTTPS probes, safe status classification, and persisted redacted health evidence in existing `connectionMetadata.health` JSON.
- Extended Studio provider readiness evidence to surface `healthStatus`, `lastHealthCheckAt`, latency, and a safe health note; OAuth connection alone remains insufficient for execution.
- Added regression coverage for healthy, authorization-rejected, transient/degraded, unsupported-provider, and malformed-evidence states.
- No schema migration, secret change, deployment, auto-merge, paid upgrade, or outbound communication was performed.


## Redis reliability repair

- Added an explicit Redis reliability policy to the existing ioredis boundary: bounded initial connect timeout, command timeout, bounded exponential reconnect delay, limited per-request retries, and ready-state checking.
- Added regression coverage for retry backoff, Redis URL credential-safe inspection, readiness classification, degraded reconnect behavior, and startup timeout handling.
- Preserved the existing degraded-start contract for non-production/test contexts and the production/staging dependency gate; no Redis configuration or infrastructure change was made.
- No production deployment, migration, secret change, paid upgrade, or auto-merge.


## Backend modular boundaries

- Added the public plugin module API at `src/server/plugins/index.ts`.
- Rewired the API launcher and engineering evidence route to consume plugin capabilities through that public API.
- Added a repository boundary check that rejects external `src/server/**` imports into plugin implementation files; internal plugin files may continue to compose directly.
- Added Vitest coverage for the boundary contract.
- No runtime behavior, database schema, provider credentials, deployment configuration, or production infrastructure was changed.


## Backend security boundary

Authenticated actor identity is now carried as a trusted `actorType` derived from Supabase app metadata (`human`, `agent`, or `service`). Provider health and provider-read Gen-X decisions no longer hard-code every authenticated request as human. Explicit agent/service identities therefore cannot inherit the human owner authorization exception. Existing sessions without an explicit actor type remain human-compatible; no credentials, secrets, migrations, or deployment settings were changed.


## 2026-11-25 — Observability HTTP boundary

- Added a privacy-safe Fastify HTTP boundary span around every API request.
- Route templates are recorded without query strings; status and duration are bounded numeric attributes.
- Shared telemetry allowlisting is reused so HTTP telemetry cannot capture headers, bodies, auth data, prompts, response content or arbitrary baggage.
- Added regression coverage for route/query privacy and response lifecycle metadata.
- No exporter configuration, secret change, migration, deployment, infrastructure change or paid telemetry service was introduced.


## 2026-11-25 — Bounded runtime metrics

- Added a small in-process runtime metrics registry for bounded request outcome counters and duration aggregates.
- Exposed the snapshot through the existing admin-only `/api/admin/metrics` diagnostics route.
- HTTP lifecycle instrumentation records success/rejected/error outcomes and bounded request duration.
- No new exporter, external telemetry service, secret, migration, deployment or infrastructure change.\n\n## 2026-11-25 — Runtime metrics cardinality guard

- Capped distinct counter series and duration series independently at 100 each.
- Existing series continue to update after the cap; unseen series are dropped without allocating new map entries.
- Added aggregate dropped-series diagnostics to the existing admin metrics snapshot.
- Added regression coverage for both caps and updates to existing series after saturation.
- No exporter, secret, migration, deployment, infrastructure or paid telemetry service was introduced.\n

## 2026-11-25 — Remove duplicate HTTP span registration

- Retained the canonical `src/telemetry/httpBoundary.ts` request span as the sole HTTP server-span owner.
- Removed the redundant `installHttpTelemetry` launcher registration and its superseded helper/test files.
- Preserved the existing HTTP outcome and duration metrics instrumentation in the launcher.
- Updated the architecture and README observability contract to match the runtime wiring.
- No exporter, credentials, schema, migration, deployment or infrastructure changes.
