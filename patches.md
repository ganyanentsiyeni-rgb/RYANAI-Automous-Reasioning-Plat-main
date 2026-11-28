
## 2026-11-28 — Frontend gate scope expanded for UI coverage

- Expanded the frontend verification test step from a small regression list to the frontend-owned test directories: `src/config`, `src/lib`, `src/hooks`, `src/components`, `src/pages`, and `src/shared`.
- This is test-scope expansion only; it does not authorize merge or deployment and does not change backend/provider behavior.
- Exact-head CI execution is still required; no pass is claimed until GitHub reports the resulting run for the current SHA.


## 2026-11-28 — UI refresh truthfulness for PA and Plugin Integrations

- Fixed PA Agent periodic/focus refreshes so a transient API, task, or Task Awareness failure no longer clears the last verified snapshot or renders a false empty/unavailable runtime state. The UI now preserves known data while explicitly reporting the latest refresh as unverified.
- Fixed Plugin & Integrations refresh handling so transient connection or registry failures preserve the last verified provider/adapter snapshot instead of converting it into an empty catalogue or disconnected state.
- Added regression coverage for PA snapshot preservation and plugin registry/connection snapshot preservation after subsequent refresh failures.
- No API, database, auth, credential, provider, deployment, or migration changes.
- Exact-head CI/security execution remains required before this branch can be treated as verified.

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

### Supabase OAuth 2.1 / U2EB repair

- Corrected the OAuth server documentation from the retired Supabase project reference to the active U2EB project `omqavyppdoniehseokvx`.
- Confirmed the repository consent route is `/oauth/consent` and is implemented as a real browser path for Supabase Auth redirects.
- Documented the U2EB hosted Site URL `https://ryanai-web-u2eb.onrender.com` and the resulting preview consent URL.
- Documented the public authorization, token, JWKS, OAuth authorization-server metadata, and OIDC discovery endpoints.
- Kept dynamic client registration disabled until the reviewed MCP dynamic-registration implementation is deployed; this avoids enabling an unrestricted client-registration surface prematurely.

### Supabase U2EB URL/OAuth configuration repair

- Corrected the local Compose Supabase default from the retired project ref to active U2EB project `omqavyppdoniehseokvx`.
- Set the hosted URL Configuration target to `https://ryanai-web-u2eb.onrender.com` as the Site URL.
- Documented the redirect allow-list for production and supported local browser ports.
- Removed the malformed `https://ryanai-web-u2eb.onrender.com/)**` entry from the documented configuration.
- Kept the API origin out of the Auth redirect allow-list because RyanAI's browser OAuth callbacks use `window.location.origin`.
- Documented the distinction between general Auth Redirect URLs and OAuth client callback URIs.
- Kept the OAuth consent path at `/oauth/consent`.
- No hosted Supabase Dashboard setting was changed by repository commits; the owner/admin must save the hosted URL Configuration values in the Supabase control plane.

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
- No new exporter, external telemetry service, secret, migration, deployment or infrastructure change.

## 2026-11-25 — Runtime metrics cardinality guard

- Capped distinct counter series and duration series independently at 100 each.
- Existing series continue to update after the cap; unseen series are dropped without allocating new map entries.
- Added aggregate dropped-series diagnostics to the existing admin metrics snapshot.
- Added regression coverage for both caps and updates to existing series after saturation.
- No exporter, secret, migration, deployment, infrastructure or paid telemetry service was introduced.

## 2026-11-25 — Mainline build-contract repair

- Removed the duplicate `exitCode` property from the AI Inspector error-report object.
- Reused the authenticated request's trusted `actorType` when evaluating Gen-X for Gmail and calendar provider reads; non-human actors do not inherit the human-owner authorization exception.
- Exposed the canonical MCP registry `version` field alongside the existing `registryVersion` field to satisfy the published tool contract.
- Corrected the MCP Dockerfile contract test's over-escaped line-splitting and COPY matcher.
- No credentials, schema, migration, deployment, provider configuration or production infrastructure were changed.

## 2026-11-25 — Remove duplicate HTTP span registration

- Retained the canonical `src/telemetry/httpBoundary.ts` request span as the sole HTTP server-span owner.
- Removed the redundant `installHttpTelemetry` launcher registration and its superseded helper/test files.
- Preserved the existing HTTP outcome and duration metrics instrumentation in the launcher.
- Updated the architecture and README observability contract to match the runtime wiring.
- No exporter, credentials, schema, migration, deployment or infrastructure changes.

## 2026-11-25 — Provider actor and MCP governance follow-up

- Fixed the Gmail provider-read route's nullable actor dereference by treating missing trusted actor metadata as `service`; Gen-X therefore fails closed rather than inheriting human owner authorization.
- Added explicit `DENY` entries for all six canonical MCP tools previously missing from the governance policy: `read_workspace_file`, `execute_sandbox_script`, `system_diagnostics`, `get_container_logs`, `execute_pipeline`, and `get_system_health`.
- The entries restore registry/policy completeness without granting delegated execution. Pipeline execution remains gated by explicit **Push Deploy** and exact-SHA release checks.
- The disposable migration regression test intentionally inserts duplicate `(user_id, key)` pairs and verifies the migration rejects them without creating the unique index. That test behaved as intended; it is not evidence of production memory corruption.
- PR #860 was merged while its exact-head CI and single-owner release gate had failed; the GitHub formal-review listing contained no submitted reviews at the time of inspection. This follow-up does not treat an issue comment as a substitute for a formal independent review or a passing release gate.
- No deployment, migration, data mutation, credential/secret change, infrastructure change, or merge is performed by this follow-up.

## 2026-11-25 — Require independent review in main ruleset proposal

- Corrected `.github/workflows/enforce-main-protection.yml` from `required_approving_review_count: 0` to `1`.
- Updated its post-application assertion to fail unless GitHub confirms at least one approving review is required.
- Retained strict exact-head status checks, no bypass actors, stale-review dismissal, and review-thread resolution.
- Kept live ruleset application behind the existing explicit `ENFORCE-REVIEWED-PROTECTION` workflow-dispatch confirmation and administrator credential. This branch change does not apply the live ruleset.
- No deployment, migration, secret/credential change, infrastructure change, or merge was performed.

## 2026-11-25 — PagerDuty contract test discovery repair

- Aligned the PagerDuty workflow path filters and unittest discovery pattern with the actual underscore-named `scripts/test_pagerduty_manager.py` file.
- The previous hyphenated path caused unittest discovery to run zero tests and exit with code 5; this was a test-discovery failure, not a PagerDuty API failure.
- Validation remains pending on this branch. No PagerDuty credentials or live API calls, deployment, migration, or infrastructure changes were made.

## 2026-11-25 — Repair independent provider deployment orchestration

- Removed the duplicate render job definition and the concatenated/incomplete duplicate Render shell implementation from .github/workflows/deploy-platforms.yml.
- Removed the duplicate Vercel timeout-minutes key.
- Made Render and Railway independent jobs after the shared exact-SHA CI/security gate; one provider failure no longer blocks the other provider attempt.
- Kept Vercel minimum-priority and opt-in, but made the selected Vercel job independent of Render and Railway after the same gate.
- Preserved the explicit PUSH DEPLOY workflow-dispatch trigger; ordinary pushes and CI completion do not deploy.
- Updated README and architecture documentation. This change only repairs workflow orchestration; it does not dispatch a deployment or contact any provider.
- Static structure review only; GitHub Actions validation and provider execution remain pending. Main ruleset review protection remains a separate merge blocker.

## 2026-11-25 — Harden exact-SHA release evidence and Vercel health verification

- Changed the Push Deploy gate to group check runs by required context and GitHub App, then evaluate the newest attempt per producer. Superseded failed attempts no longer permanently block a successful rerun; any latest failed producer fails the gate, and pending/missing contexts remain blocked.
- Changed Vercel health verification to use the newly created deployment URL with the health-path suffix from the configured URL, avoiding a false positive from checking an existing production domain.
- No deployment, domain change, credential change, or production infrastructure operation was performed. The changes are on branch fix/release-gate-duplicate-checks-vercel-health-20261125 and require independent review after main-branch protections are restored.

## 2026-11-25 — Exclude environment files from CLI deployment artifacts

- Added `.railwayignore` and `.vercelignore` patterns for root and nested `.env` / `.env.*` files, while allowing credential-free example templates.
- Added both ignore files to the root `.gitignore` allowlist so the deployment safeguards themselves are committed.
- Updated README and architecture documentation to distinguish artifact exclusion from Git-history cleanup and credential remediation.
- Static configuration change only; no provider upload or deployment was performed.

## 2026-11-25 — Harden exact-SHA release evidence and Vercel health verification

- Changed the Push Deploy gate to inspect every check run matching each required name. A duplicate failed result now fails the gate; a duplicate incomplete result keeps it pending instead of allowing the latest successful run to mask it.
- Changed Vercel health verification to use the newly created deployment URL with the health-path suffix from the configured URL, avoiding a false positive from checking an existing production domain.
- No deployment, domain change, credential change, or production infrastructure operation was performed. The changes are on branch fix/release-gate-evidence-integrity-20261125 and require independent review after main governance is restored.

## 2026-11-25 — Preserve independent release-check producers across reruns

- Refined exact-SHA check grouping to include the GitHub Actions workflow ID in addition to required context and GitHub App. Independent workflows publishing an identically named context are evaluated separately.
- Within each producer, only the newest attempt is authoritative: a successful rerun can supersede that producer's older failure, but cannot hide another workflow producer's failure or pending result.
- Removed an accidental duplicate 30-second sleep from the release-gate polling loop so its stated 45-minute timeout and 90 polling attempts align.
- Consolidated contradictory release-gate descriptions in README and architecture documentation.
- No workflow dispatch, deployment, provider call, production change, or credential change was performed. Static edits remain unvalidated by GitHub Actions tooling and require review after main governance is restored.

## 2026-11-25 — Resolve release-check producers through Actions run metadata

- Corrected producer identity mapping: the observed GitHub CheckRun.check_suite payload contains a suite ID but not a workflow ID. The gate now extracts the Actions run ID from each check's details URL and maps it to the workflow ID returned by the exact-SHA Actions-runs API.
- Distinct workflow producers sharing a context remain separate. Within each mapped producer, only the newest check attempt is authoritative.
- Unmapped Actions runs are conservatively separated by run ID; this may keep an old failure blocking, but cannot allow another producer to hide it. External providers use external ID or details URL identity.
- No PR, merge, workflow dispatch, deployment, provider call, production change, or credential change was performed. The revised workflow remains unvalidated by actionlint/YAML parsing and GitHub Actions execution.

## 2026-11-25 — CI lint and MCP contract repair

- Corrected over-escaped regular expressions and path-separator normalization in `scripts/backend-module-boundaries.mjs`; the prior import matcher failed ESLint parsing before the boundary test could run.
- Imported `assertCanonicalMcpTool` from the canonical registry in the MCP delegation contract test and iterated the expected tool/capability tuples without an unused binding.
- These are source-level lint repairs only. Exact-SHA CI rerun, full test suite, independent review, and main protection remain required; no deployment, migration, secret, provider, or production change was made.
- Validation branch: `repair/ci-lint-boundary-contract-20261125` (head `37df81848c107b570963d93b88f053b14adfbcbc` before this documentation-only commit). CI execution is required; no pass is claimed until exact-head workflow evidence is complete.

## 2026-11-25 — exact-SHA CI contract repair

- Reconciled backend module-boundary imports with the plugin public API and preserved a stable MCP unknown-tool error contract.
- Updated Redis readiness tests to assert the reliability options actually used by `connectRedis`; the configured initial readiness deadline is now honored without an artificial 250 ms floor.
- Updated provider/auth test fixtures to include the trusted `human` actor classification introduced by the provider Gen-X network gate, and corrected the environment-contract test to use a supported error assertion pattern.
- These changes target the exact failures observed on main CI. They do not change provider deployment, production database migration, secrets, or production infrastructure.

## 2026-11-25 — Expand PA Agent sourced skills

- Added a governed PA sourced-skill registry covering live research/source verification, synthetic observability and post-change verification, correction-to-guardrail proposals, Supabase database governance, edge security advisories, incident evidence/recovery, and provider/model routing review.
- The registry records provenance, capability scope, execution mode, risk, and enabled state for every skill.
- The OpenRouter/provider-model-routing skill is deliberately disabled because that proposal remains paused.
- Active sourced skills are read-only or proposal-only and cannot change credentials, schemas, provider configuration, deployments, or external communications.
- PA runtime status now reports the adopted sourced-skill IDs alongside Task Awareness.
- Added regression coverage for registry completeness, paused-provider state, evidence recording, and bounded execution modes.
- No external vendor connection, credential change, database migration, deployment, merge, or paid upgrade was performed by this patch.

## Owner access and dashboard workspace preferences

The Supabase-verified account `rmnganyane@gmail.com` is the canonical RyanAI owner. The API resolves that verified email to both `isOwner: true` and `role: admin`; the optional `RYANAI_OWNER_EMAIL` may designate an additional owner but cannot displace the canonical owner. Browser-editable user metadata is never an authorization source.

The fourteen Dashboard UI options control navigation and dashboard-shortcut visibility only. Settings remains available. Hiding a workspace does not revoke its server-side permission, and enabling a preference does not grant access. Admin Console and RyanAI Communications retain their separate verified administrator/owner authorization checks. Desktop and mobile navigation use the same visibility rules.

This change is delivered through a reviewable pull request. It does not authorize production deployment, database migrations, credential changes, or a bypass of required CI/security checks.

## 2026-11-26 — Align dashboard shortcuts with the fourteen workspace options

- Removed the legacy Audiobook Studio shortcut from the Commander Dashboard so the dashboard shortcuts match the fourteen user-selected workspace options.
- Updated navigation regression assertions: hidden legacy Audiobook Studio is not a navigation destination, while enabled workspaces remain visible and hidden workspaces remain directly addressable without changing authorization.

## Frontend dashboard and workspace visibility

- Workspace visibility preferences are applied consistently to desktop navigation, mobile navigation, and Dashboard shortcut cards.
- The Dashboard visibility option controls its navigation entry; Settings remains available so users can restore hidden workspaces.
- Hiding a workspace affects presentation only and does not revoke direct-route or API authorization. Enabling a workspace does not grant permissions.
- Admin Console and RyanAI Comms remain role/owner gated independently of visibility preferences.
- Regression coverage verifies hidden workspaces, the Settings recovery path, Dashboard visibility, and direct-route authorization.

## 2026-11-26 — Align dashboard shortcuts with the fourteen workspace options

- Removed the legacy Audiobook Studio shortcut from the Commander Dashboard so dashboard shortcuts match the fourteen user-selected workspace options.
- Updated navigation regression assertions to exclude the legacy audiobook destination while preserving direct-route access and permission boundaries.
- No backend permission, deployment, database, credential, or production configuration was changed.

## 2026-11-26 — Respect workspace visibility in dashboard quick actions

- Applied the workspace visibility preference to the Commander Dashboard's secondary "Open workspace" quick action, not only the workspace card grid.
- Added a regression test proving a disabled Reasoning Workspace is not exposed by that quick action while Settings remains available.
- No route authorization, backend permissions, production configuration, credentials, database, or deployment behavior changed.

## 2026-11-26 — Ignore stale Operations Center refresh responses

- Added monotonically increasing request guards to task-history and administrator approval-inbox refreshes.
- Older responses can no longer overwrite newer account-scoped data after an account/role change or overlapping refresh.
- Clear prior resource errors on successful refresh; regular-account refresh explicitly clears the administrator-only inbox.
- No API authorization, task execution, approval semantics, production configuration, or deployment behavior changed.

## 2026-11-26 — Invalidate Comms approval when attachment draft changes

- Selecting or replacing files now starts a fresh draft identity and clears any prior approval ID/status, matching the existing invalidation behavior for message, channel, recipient, subject, and attachment removal.
- Added a regression test proving a previously approved message cannot retain its Send approved message action after the attachment selection changes.
- This is a frontend state-integrity guard; the backend approval and owner authorization checks remain authoritative.
- No external message was sent, no production deployment, migration, credential change, or merge was performed.

## 2026-11-26 — Memory Vault pagination feedback

- Memory Vault now enters a visible loading state for refresh, search, and next-page requests; pagination controls remain disabled while the request is pending, preventing repeated clicks from issuing duplicate page fetches.
- Added a deferred-response UI regression test for the next-page loading state and disabled control.
- This is a frontend request-feedback repair only. It does not change memory authorization, persistence, retention, or database schema.
- Tests have not been executed in this environment; exact-head CI remains required. No merge, deployment, migration, credential change, or production modification.


## 26. Provider readiness gate correction — 26 November 2026

- Changed the U2EB Render API Blueprint health check from `/health` (process liveness) to `/readyz` (application readiness). The API readiness contract includes database, Redis, LangGraph/checkpointer, and agent queue-listener dependencies; a process-only health response must not certify the application as ready.
- Kept the API Dockerfile, repository, `main` branch, root directory, Free plan, Oregon region, and `checksPass` auto-deploy policy unchanged in the Blueprint.
- This is a repository Blueprint correction only. It does not mutate the inaccessible live Render workspace, existing service settings, or deployments.
- Railway source/build alignment remains blocked by Railway account suspension. No service, source, volume, variable, or deployment changes were applied.
- Required exact-SHA CI/security checks, a recorded human approval, and explicit Push Deploy remain mandatory before any provider deployment.

- Fixed the missing `fetchSystemHealth` import in the browser fallback of `TauriBridge` and added a regression test for browser system-health checks.
- Corrected the disposable PostgreSQL notification/queue CI step to run with `NODE_ENV=test` and explicit disposable-database flags. The previous job imported the Prisma singleton with its production default and incorrectly required a hosted Supabase project mapping for loopback CI PostgreSQL.
- The duplicate `(user_id, key)` migration preflight is an intentional negative test; it passed. No production memory records were changed.
## 2026-11-26 — Frontend environment and operational truth increment

- Added a shared browser-environment validator used by Vite build configuration and the runtime API base URL resolver.
- Rejects server-only credentials under `VITE_*` names, permits only the explicitly browser-safe Supabase anon/publishable key names, rejects URL-embedded credentials, and requires HTTPS/non-loopback API endpoints in staging and production.
- Added focused regression tests for localhost/loopback, staging HTTPS, missing hosted API configuration, forbidden secret names, safe Supabase public keys, and URL normalization.
- Added `useRyanOperations` and browser contracts for the API routes that exist today: AgentRun task listing/dispatch, operational awareness, PA observer status, task approval/rejection, and PA delegation.
- The hook uses authenticated API requests, validates essential response fields, waits for backend-confirmed action results, preserves independent telemetry when one source fails, and polls only while runs are active.
- Added the standalone `RyanAI Frontend Verification Gate` and integrated its focused environment/health tests, explicit production web build, and compiled-bundle credential/loopback audit into the existing CI workflow so this PR receives pre-merge verification before the new workflow reaches main.
- Deliberately did not invent detailed health, agent/worker registry, MCP tool, Comms receipt, or capabilities endpoints: the proposed `/api/v1/*` paths are not the current API route contract. These require backend implementation and contract tests before the frontend can truthfully render them.
- No branch-protection rule was modified, no PR was merged, and no deployment, migration, credential change, provider configuration change, or production operation was performed. Exact-head CI evidence and independent review remain required.
## 2026-11-26 — GitHub Integration status refresh feedback

- Refreshing an already-loaded GitHub connection now re-enters a visible checking state and disables repeat refresh while the authenticated status request is pending.
- Added a deferred-response UI regression test for the pending/disabled state.
- This is status-feedback only; OAuth, repository permissions, review provenance, GitHub App installation, and authorization behavior are unchanged.
## 2026-11-26 — Reset Quant Lab state on account changes

- Keyed the Quant Lab page by the authenticated user ID so an account switch remounts the workspace and clears in-memory experiments, imported dataset selection, signals, backtest results, and related notices from the prior account.
- Added an application-level regression test that switches the authenticated session while remaining on the Quant Lab route and verifies the page is remounted for the new user.
- This is a frontend state-isolation safeguard; authenticated API scoping remains authoritative. No brokerage connection, live order capability, database migration, credential change, deployment, or production configuration was changed.
- Tests have not been executed locally; exact-head CI and security checks remain required before any merge or deployment.
## 2026-11-26 — Inference Console cancellation safety

- Added an explicit Cancel control to the Inference Console while a reasoning stream is running.
- Threaded an optional `AbortSignal` through `streamReasoning` into the authenticated API request and suppresses abort errors from being reported as provider failures.
- Aborts active inference on component unmount so a discarded console cannot continue an in-flight stream or update UI state after navigation.
- Added regression coverage proving the caller signal reaches authenticated transport and aborts do not trigger completion or error callbacks.
- This is a frontend/request-lifecycle safety repair only; model catalog, provider authorization, backend policy, database schema, credentials, deployment and production configuration are unchanged.
- Tests have not been executed in this environment; exact-head CI remains required. No merge, deployment, migration, credential change, or production modification.


## 2026-11-26 — Resume OpenRouter governance implementation

- Preserved the trusted Supabase actor type (`human`, `agent`, or `service`) in API-issued MCP delegation assertions and re-evaluated Gen-X using that signed actor classification at delegation, execution authorization, and provider dispatch.
- Removed the hard-coded `actorType: human` assumption from delegated reasoning. Explicit agent/service identities are denied by the existing human-only reasoning policy and cannot inherit owner permissions.
- Added regression coverage across API delegation, API provider gateway, HMAC token verification, and MCP token verification.
- OpenRouter remains optional and runtime-disabled pending the remaining catalogue, usage/cost, reliability, privacy, regional-data, and staging acceptance gates. No provider key, billing, hosted environment, deployment, migration, or external API call was changed.


## 2026-11-26 — Logic OpenRouter override routed through API gateway

- Replaced the Logic override's direct `ChatOpenAI` construction and direct endpoint/key resolution with `resolveSelectedReasoningModel` backed by the canonical provider registry and `invokeConfiguredProvider` shared API-owned adapter.
- The worker now requires a persisted approved AgentRun, revalidates its current worker lease immediately before provider dispatch, and evaluates Gen-X using the internal `approvedAgentRun` context. The worker-only context is distinct from route-only `ownerAuthorized` and is never accepted from model/tool input.
- The API MCP gateway and approved AgentRun worker now share the same provider request shaping, server-held credential resolution, HTTPS/allowlist checks, normalized text response, usage normalization, and no-tool-execution behavior.
- Existing `gpt-4o` and `gpt-4o-mini` selections continue to use the configured Logic provider. Only the two explicitly catalogued OpenRouter aliases may select the OpenRouter route.
- Added model selection, provider invocation, and Gen-X policy regression tests. Exact-head CI is still required; tests have not been executed locally in this workflow.
- OpenRouter remains runtime-disabled. No provider API request, secret/billing change, hosted configuration change, merge, migration, or deployment was performed.


## 2026-11-26 — PA delegation UI uses the operational contract hook

- Routed the shared PA/Darkside Copilot delegation creation action through `useRyanOperations().createPADelegation()` rather than maintaining a second raw POST implementation in the panel.
- Extended the hook to accept the panel's stable delegation UUID and send it with the objective and capability scope, preserving retry identity and avoiding duplicate delegation creation.
- The UI continues to wait for backend-confirmed `success`, `delegationId`, `taskId`, and `approved | pending_approval` before clearing the draft or displaying an accepted notice.
- Added hook regression coverage for stable ID propagation and a Gen-X/backend 403 denial; denied requests do not report success.
- This is frontend integration only. Server-side authorization and execution boundaries are unchanged; no deployment, migration, credential change, or production action.


## 9. Environment-example contract validator alignment (PR #953)

- Replaced the stale exact-three-variable assertion for `.env.example` with explicit checks for the active U2EB Supabase URL and Session Pooler host, while requiring `DATABASE_URL`, `DIRECT_URL`, `AUDIOBOOK_DATABASE_URL`, `AUDIOBOOK_DATABASE_URL_UNPOOLED`, and `VITE_SUPABASE_PUBLISHABLE_KEY` to remain blank in the committed template.
- This corrects the validator drift introduced when the example was expanded to document frontend and audiobook runtime configuration.
- The patch changes validation only; it does not populate credentials, alter provider configuration, run migrations, or deploy.
- PR #953 must pass all required exact-head CI/security checks and required review before merge. Vercel checks are currently failing with the team's Hobby build-rate limit; this is a provider/account capacity block, not a successful deployment.
## 2026-11-26 — Admin Console backend plugin capability catalogue

- Added a read-only Admin Console view backed by the authenticated `GET /api/plugins/registry` endpoint.
- Displays server-declared provider metadata, capability IDs, risk classifications, human-approval flags, data classifications, manifest versions and adapter registration state.
- Validates the response shape and visibly distinguishes API/contract failures from a confirmed empty catalogue.
- Explicitly does not infer user permissions, provider connection/health, or executable authority from catalogue metadata. No credentials, connection records or adapter methods are exposed by the route.
- Added component tests for authenticated loading, manifest rendering, invalid payloads and HTTP 403. Tests/build have not been run locally in this workflow; exact-head CI remains required.
- No backend authorization policy, provider credential, database schema, deployment, merge or production configuration was changed.
## 2026-11-26 — Command Cockpit AgentRun queue visibility

- Added a dedicated AgentRun queue panel to the Command Cockpit using the shared authenticated `useRyanOperations` hook.
- Exposes API-reported queued/running/failed/cancelled/total counters, recent persisted AgentRuns, approval state when present, last confirmed snapshot time, and manual refresh.
- Missing counters and approval state render as `Not reported`; an empty task response is not presented as proof of a healthy or empty queue.
- Reuses the hook's active-run polling behavior; no new API route, registry assertion, approval action, lease mutation, migration, deployment, or production change.
- Exact-head CI/build/security checks remain required; tests have not been run locally in this workflow.

## 2026-11-26 — OpenRouter optional configuration and gateway regression coverage

- Added optional server-only `OPENROUTER_API_KEY`, HTTPS endpoint, and explicit model allowlist entries to `.env.example`.
- Declared the same optional variables for the Render U2EB API service. The key remains `sync: false`; no credential value is committed or provisioned.
- Documented that Logic synthesis uses the shared API-owned provider adapter and requires an approved AgentRun plus a fresh live worker lease.
- OpenRouter remains runtime-disabled pending catalogue, versioned ZAR pricing, streaming/tool policy, reliability/failover, privacy/data-region, and staging acceptance evidence.
- No provider API call, secret change, billing change, hosted configuration change, deployment, migration, or production modification was performed by this configuration/documentation increment.


## Optional AWS ECS and Azure AKS staging workflows

Added two manual-only provider lanes on this repair branch:

- `.github/workflows/deploy-aws-ecs.yml`: exact-SHA open-PR validation, completed CI/security check gate, dedicated `aws-staging` environment, GitHub OIDC role assumption, immutable ECR image, ECS task-definition render/deploy, ECS stability wait, and HTTPS `/readyz` verification.
- `.github/workflows/deploy-azure-aks.yml`: exact-SHA open-PR validation, completed CI/security check gate, dedicated `azure-staging` environment, Azure federated login, immutable ACR image, Kustomize apply, named Deployment image update, rollout wait, and HTTPS `/readyz` verification.
- Updated `scripts/audit-deployment-readiness.mjs` and the CI readiness environment mapping to audit OIDC-based AWS configuration and the additional Azure staging deployment/health/isolation settings. Static AWS access keys are no longer the expected AWS identity mechanism.
- Updated README with the optional staging lane contract.

Both lanes are disabled unless their provider enablement and staging-isolation variables are explicitly set to `true`, and each manual dispatch requires `STAGE`. They are not part of the existing three-provider PUSH DEPLOY fan-out. No cloud account, role, registry, cluster, service, environment secret, production resource, or deployment was created or modified. Workflow execution and live provider readiness remain unverified.
## 2026-11-26 — Admin Console AI Inspector evidence

- Added a read-only Admin Console view over the existing authenticated AgentRun list and persisted evidence records; no new endpoint or database change.
- Accepts only `pa.capability.executed` events whose payload identifies `ai-inspector.inspect` and contains the report, source, SHA-256 digest, and documented exit code.
- Surfaces structured findings and the durable report with event ID/sequence and recorded digest.
- Distinguishes no recent task, task without report evidence, malformed evidence, API/source errors, completed-with-findings (exit code 1), and completed exit code 0.
- Explicitly does not equate exit code 0 with a clean audit, independently verify the hash chain, prove runtime health, launch audits, or perform remediation.
- No migrations, credential changes, deployment, or production modifications.

## 2026-11-26 — AgentRun read-only migration compatibility evidence

- Audited the canonical `main` source at `abcecd9c38787f83abcbd8d12eb754412df80b45` without connecting to the production recovery target.
- Corrected the recovery runbook: the 42-migration / 8-ledger-entry figures are dated 8 November observations, not current production state; the repository currently contains 61 primary Prisma migration directories.
- Cross-checked the `AgentRun` Prisma model against `database.yml` and the ordered base, execution-scope, trace-context, runtime-contract, queue-classification, lease-heartbeat, and fail-closed approval migrations.
- Recorded that the runtime-contract migration performs row reclassification as well as DDL, and must not be manually replayed after recovery.
- Full compatibility remains unverified: the latest exact-SHA database/CI workflows were cancelled, and no isolated clone of the exact production migration ledger was inspected. No production connection, SQL execution, migration, deployment, credential change, or gate bypass was performed.


## Optional AWS ECS and Azure AKS staging workflows

Added two manual-only provider lanes on this repair branch:

- `.github/workflows/deploy-aws-ecs.yml`: exact-SHA open-PR validation, completed CI/security check gate, dedicated `aws-staging` environment, GitHub OIDC role assumption, immutable ECR image, ECS task-definition render/deploy, ECS staging-tag verification and stability wait, and HTTPS `/readyz` verification.
- `.github/workflows/deploy-azure-aks.yml`: exact-SHA open-PR validation, completed CI/security check gate, dedicated `azure-staging` environment, Azure federated login, immutable ACR image, Kustomize apply in an explicit staging namespace, named Deployment image update, rollout wait, and HTTPS `/readyz` verification.
- Updated `scripts/audit-deployment-readiness.mjs` and the CI readiness environment mapping to audit OIDC-based AWS configuration and Azure staging deployment/health/isolation settings. Static AWS access keys are no longer the expected AWS identity mechanism.

Both lanes are disabled unless their provider enablement and staging-isolation variables are explicitly set to `true`, and each manual dispatch requires `STAGE`. They are not part of the existing three-provider PUSH DEPLOY fan-out. No cloud account, role, registry, cluster, service, environment secret, production resource, or deployment was created or modified. Workflow execution and live provider readiness remain unverified.


## 2026-11-26 — Docker API and Studio Worker runtime parity guard

- Extended deployment-contract validation to compare the root multi-target Dockerfile and standalone API Dockerfile runtime healthcheck, entrypoint, and startup command.
- Added required-runtime-artifact checks for package metadata, database configuration, dependencies, server output, source/scripts, quant engine, startup backup, and CA verification wrapper.
- Added parity checks for the Studio Worker target's disabled HTTP healthcheck and exact worker process command.
- Static contract assertions only; Docker builds and runtime behavior remain subject to exact-SHA CI verification. No image publishing, deployment, migration, secret change, or production access.


## 2026-11-26 — Compose startup and optional gateway credential boundary

- Added static Compose contract checks for API dependencies on healthy local PostgreSQL and Redis, web/MCP health ordering, local-only opt-in migrations, loopback-only database/cache host ports, and opt-in MCPJungle/Cloudflare profiles.
- Made the optional MCPJungle PostgreSQL password mandatory at Compose interpolation time for both database initialization and the gateway connection string; removed the empty-password fallback.
- Compose remains a local development topology. No production database, credential, deployment, image publication, or migration was changed. These are source-level checks pending exact-SHA CI.


### Compose follow-up — credential symmetry and health semantics (2026-11-26)

- Removed the remaining empty-password fallback from the MCPJungle PostgreSQL initializer, matching the gateway connection requirement.
- Extended static contracts to protect API liveness (`/livez`, `/health`) from dependency readiness (`/readyz`), MCP's liveness-based startup ordering, its explicit API readiness target, and local-only migration URL routing.
- CI's Docker workflow includes `docker compose --file docker-compose.yml config --quiet`; execution on the exact PR SHA is pending. No local Docker daemon/runtime validation is claimed.


### AWS ECS and Azure AKS staging gate alignment (2026-11-26)

- Expanded both staging workflows to require the full configured application, database compatibility, dependency, static-analysis, secret-audit, image-scan, and SBOM check set on the candidate commit before credentials, image publication, or cluster/service mutation can occur.
- Existing explicit `STAGE` confirmation, disabled-by-default provider flags, staging-isolation confirmation, OIDC authentication, immutable SHA image tags, and runtime `/readyz` verification remain in place.
- This is workflow-level defense in depth; it does not activate AWS/Azure, configure cloud credentials, deploy, or replace repository branch protection.
### Governed release exact-SHA gate (2026-11-26)

- Added a fail-closed preflight to the manual staging/production release workflow. It verifies the dispatched commit is still current `main` and requires every configured application, database, dependency, code-scanning, secret-scanning, image-scan, and SBOM check context to exist and have completed successfully on that exact SHA.
- Both staging and production release jobs now depend on this preflight. The production migration approval input remains an additional independent requirement.
- The preflight does not wait for checks or alter branch rules; if evidence is pending, missing, stale, or unsuccessful, the operator must not release. No deployment or migration was run as part of this patch.


### Exact-SHA latest-attempt check selection (2026-11-26)

- Centralized the required release check names in `scripts/ci/required-release-checks.json` and the validator in `scripts/ci/require-latest-exact-sha-checks.mjs`.
- Release, AWS ECS staging, and Azure AKS staging gates now select the newest check run for each required context by start time (check-run ID breaks timestamp ties), then require that selected run to be completed successfully and to reference the exact candidate SHA.
- Older failed/cancelled attempts no longer permanently block a context after a newer successful rerun; a newer pending/failed/cancelled attempt still blocks. Missing contexts and mismatched SHAs remain fail-closed.
- Added automated tests for reruns, pending latest attempts, missing contexts, SHA mismatch, and duplicate timestamps. No deployment, cloud authentication, image publication, migration, or branch-ruleset change is performed by this patch.

# CI execution completeness

The release-check catalogue is now treated as an execution contract, not only a list of names.

`CI execution completeness` runs on every main push and pull request and waits for the catalogue contexts to appear for the candidate SHA. For each context it selects the newest check attempt by `started_at` (check-run ID as the tie-breaker), then requires:

- the check exists for the candidate SHA;
- the newest attempt is completed;
- the conclusion is `success`;
- the check's `head_sha` exactly matches the candidate SHA.

A missing workflow, a workflow that never starts, a pending check, a failed/cancelled/skipped check, or a check attached to another SHA therefore remains a release blocker.

This verifier does not deploy, publish images, run migrations against shared/production databases, change credentials, or modify branch rulesets. It is diagnostic/gating evidence for CI execution itself.


## 2026-11-26 — Canonical CI release-check producer inventory

- Added `scripts/ci/required-release-check-producers.json` as the canonical producer map for all 19 release-gate contexts, including workflow and job ownership.
- Added `scripts/ci/validate-release-check-producers.mjs` to reject duplicate contexts, missing producer workflows, undeclared check names, and drift between the producer inventory and `required-release-checks.json`.
- Updated the manual PUSH DEPLOY gate to read the canonical producer inventory instead of maintaining a second hard-coded 19-context list.
- Added independent Docker CI producers named `Scan api image` and `Scan web image`; they build the non-published API/web images and run Trivy HIGH/CRITICAL vulnerability scans before release evidence can pass.
- No deployment, image publication, migration, credential change, or branch-ruleset change was performed. Exact-SHA CI execution remains required.

## 2026-11-26 — Release-gate validator normalization

- Normalized Render staging, Railway staging, production migration, and guarded Render repair workflows to use the canonical `scripts/ci/require-latest-exact-sha-checks.mjs` validator instead of maintaining smaller, divergent required-check lists.
- Those gates now require the complete 19-context release evidence contract on the exact target SHA. The gates remain fail-closed and no provider deployment, migration, credential change, or ruleset change was performed.



## 2026-11-26 — Docker CI fan-out deduplication

The PR Docker workflow no longer runs a separate application/MCP/Compose validation job. Those checks duplicated authoritative CI work already produced by `ci.yml` (`Validate (typecheck, lint, test, build)` and `MCP server and workflow worker`). Docker PR scanning now consumes the images built by `build-pr` directly. The required `Scan api image` and `Scan web image` contexts remain unchanged; the release gate still obtains application validation from the canonical CI producers.


## 2026-11-26 — Container security duplicate scan removal

- Audited the PR-triggered container security fan-out and confirmed that its api and web matrix entries rebuilt and scanned the same runtime images already built once by the canonical Docker workflow and scanned by the required `Scan api image` and `Scan web image` producers.
- Removed only those two duplicate matrix entries from `container-security.yml`; standalone API, MCP, and migration image scans remain intact.
- The canonical 19 release-check contexts are unchanged and continue to be produced by their designated workflows.
- No image publication, deployment, migration, credential change, or ruleset change was performed.


## 2026-11-26 — RyanAI application layer integrity baseline

- Established a canonical eight-layer application contract covering Experience, Application/API, Identity/Security/Governance, Orchestration/Workforce, Reasoning/Intelligence, Tools/Integrations, Data/Persistence, and Runtime/Platform.
- Documented intended dependency direction, Gen-X authority boundaries, the PA objective end-to-end lifecycle, evidence semantics, and the distinction between static inventory and live runtime proof.
- Added a bounded read-only audit that inventories declared layer roots, counts source files, maps resolvable relative-import edges, and reports unresolved relative imports and unclassified source files.
- Added focused Node tests for layer discovery, cross-layer dependency reporting, unresolved imports, ignored dependency directories, repository-root confinement, and cancellation.
- Added `audit:application-layers` and `test:application-layers` package scripts and wired the focused tests into `npm run validate`.
- The audit does not execute discovered code, read environment values, make network calls, inspect credentials, connect to services, run migrations, or claim runtime health. Static baseline output is not a clean-architecture or production-readiness certification.
- No speculative source-module moves, authorization-policy changes, database/schema/migration changes, credential changes, provider changes, production mutations, merges, or deployments.


## 2026-11-26 — Bind Studio owner approval to exact task content

- Added a versioned SHA-256 digest over each Studio task's execution-relevant identity, objective, task type, priority, required capabilities, assigned worker, dependencies, and input.
- Owner approval now records that digest in the append-only `task.human_approved` event and uses a conditional task-state update to avoid recording approval after a concurrent status/approval change.
- Gen-X's `REQUIRE_APPROVAL` path now accepts only a well-formed approval event whose digest exactly matches the task being claimed for execution. Legacy events, unsupported digest versions, missing evidence, and stale task-content approvals fail closed.
- Gen-X `DENY` remains absolute; runtime state, leases, timestamps, and output are excluded from the digest.
- Added canonicalization and regression coverage for changed execution fields, legacy/malformed approvals, and DENY precedence.
- No database migration, production data change, merge, deployment, credential change, or ruleset modification.
- Local test execution and exact-SHA CI/security evidence remain pending.


## 2026-11-26 — Self-Patch exact-head approval request issuance

- Added an authenticated owner-only endpoint to request a review of an open pull request targeting `main` in the canonical RyanAI repository.
- The API reads the live PR through the scoped GitHub App installation and records the observed head SHA in a 15-minute pending approval row. Closed PRs, non-main targets, cross-repository heads, invalid PR numbers, and unavailable GitHub App access fail closed.
- Added a Gen-X rule that permits only a verified human owner to create the pending request record. This permission does not authorize GitHub review submission, merge, deployment, or Self-Patch promotion; promotion remains `REQUIRE_APPROVAL`.
- The issuance flow creates an idempotent internal Comms AgentRun for PA to coordinate the owner decision. Its objective explicitly prohibits external WhatsApp/SMS/voice/email dispatch. If task creation fails, the pending approval is marked blocked.
- Added regression tests for eligible PR issuance, ineligible PR rejection, Comms task creation failure, and Gen-X owner-scope enforcement.
- The existing inbound approval command still fails closed for `APPROVE` until independent Gen-X authorization evidence is available. No GitHub review is submitted by this change.
- No migration, production data change, credentials change, ruleset change, merge, or deployment. Local test execution and exact-SHA CI/security results are pending.


## 2026-11-26 — Remove hard-coded MongoDB connectivity target

- Replaced the optional `test_mongo.py` example's embedded Atlas hostname and username with the server-side `MONGODB_URI` environment variable.
- Added a clear missing-configuration failure, bounded server-selection/connect timeouts, and guaranteed client closure.
- Kept MongoDB as a distinct optional integration; this change does not assign collection ownership, alter Neon/Supabase PostgreSQL schemas, or add a production MongoDB dependency.
- No credentials, production data, database migrations, deployment settings, or governance rules were changed.
- Exact-SHA CI validation is pending.

## 2026-11-27 — Sanitize the tracked environment template

- Removed malformed legacy connection-string fragments and credential-looking MongoDB/Neon values from `.env.example`.
- Restored a single blank `DATABASE_URL` / `DIRECT_URL` contract and retained blank optional external database variables.
- Kept `CORS_ORIGINS` explicit for local frontend origins and the U2EB web origin; no secrets, production environment values, or provider settings were changed.
- Follow-up: rotate any credential that was live and previously committed; removing it from the repository does not revoke it. Exact-head CI/security checks are required before merge; no deployment or migration is authorized by this patch.

## 2026-11-27 — Reconcile names-only base environment contract

- `.env.example` now contains variable names with blank values only, matching the dedicated names-only CI guard and preventing public routing values or secrets from being mistaken for runtime credentials.
- Public U2EB routing values, including `CORS_ORIGINS`, remain in `.env.u2eb.example`; deployment-contract validation now checks that overlay separately while asserting every base template value is blank.
- This is a template/contract correction only. No platform environment values, credentials, domains, migrations, or deployments were changed.

- Split exact-SHA staging evidence from main/release evidence with scripts/ci/required-staging-checks.json. Render and Railway PR-staging gates now validate the PR-compatible 18-context catalogue instead of requiring the main-only Render configuration audit.
- Extended the exact-SHA validator to accept an explicit catalogue while preserving the release catalogue as the default.
- Added regression coverage proving the staging catalogue excludes the main-only Render audit and contains unique contexts.
- Expanded Docker PR path coverage so deployment-readiness changes trigger the API/web image build and scan producers required by the staging evidence contract.

## 2026-11-28 — Agent UI approval dialog keyboard accessibility

- Added initial focus to the safe Decline action when an agent UI approval request opens.
- Added keyboard focus containment, Escape-to-decline behavior, and focus restoration to the invoking control when the dialog closes.
- Added `aria-describedby` linkage for the exact approval summary and visible focus indicators on both decision controls.
- Added regression coverage for initial focus, Escape dismissal, and focus restoration while preserving the server-authoritative authorization boundary.
- This is a frontend accessibility repair only. Local test execution and exact-head CI/security evidence remain pending; no merge, deployment, migration, credential change, or authorization-policy change is included.

## 2026-11-28 — PA Agent terminology consistency

- Replaced the legacy visible “Alex” persona label across Profile Settings, Darkside Copilot, the PA delegation desk, PA Agent capability copy, and the neural identity display with the product-facing name “PA Agent”.
- Updated the Darkside milestone documentation and added regression assertions for Profile Settings, Copilot status labels, and the accessible neural identity name.
- Preserved the persisted `showAlexStatus` preference key, `alex` identity lookup key, and existing backend handoff identifiers for compatibility; these are internal contracts, not user-facing labels. No API schema, authorization, persistence, deployment, or runtime behavior was changed.
- Exact-head CI and test execution remain pending.

## 2026-11-28 — Command Center mobile drawer accessibility

- Hardened the conversation-history and live-telemetry mobile drawers with a shared keyboard Tab focus-trap utility and a `focusin` guard that returns escaped focus to the active drawer.
- Added explicit `aria-controls` relationships from both drawer triggers to their corresponding modal panels; opening one drawer closes the other so only one modal is active.
- Added unit coverage for forward/backward wrapping and focus that escapes the drawer. The existing Escape-close and trigger-focus restoration behavior is preserved.
- Frontend interaction/accessibility only. Local test execution and exact-head CI/security checks remain pending; no backend, infrastructure, credential, migration, or deployment changes.


### Operator Console offline outbox account-switch safety (2026-11-28)
- Scoped outbox reads and sync UI updates to the account and request generation that initiated them; late IndexedDB/network completions are ignored after an auth-account change.
- Clear prior-account queue/error presentation on account changes and filter rendered records by the active owner as a final UI boundary. Existing stable task IDs and server acceptance rules remain unchanged.
## 2026-11-28 — Operations Center stale approval safety

- Prevent previously loaded administrator approval actions from remaining actionable when the latest approval-queue refresh fails or is still in progress.
- Display an explicit warning that the old queue is hidden until a fresh queue response can be verified; retain the request error and retry path.
- Added a regression test proving an approval action is not visible/actionable after the refresh endpoint returns an error.
- Frontend-only safety behavior. Backend administrator authorization remains authoritative and unchanged. Test execution and exact-head CI/security checks remain pending.
## 2026-11-28 — PhoneLink async refresh and inbox error states

- Fixed the Comms inbox refresh path so a failed inbox request no longer clears the last successfully loaded events or presents a false “No queued mobile updates” empty state.
- Added a visible, accessible inbox-specific error with a retry action and a truthful unavailable-state message; a successful refresh clears the inbox error.
- Changed periodic refreshes to avoid re-entering the initial device-loading state after the first load, preventing the device list from flashing its loading placeholder every 15 seconds.
- Added a regression test proving the last known inbox events remain visible after a subsequent inbox failure. Test execution and exact-head CI/security checks remain pending.


### Operator Console replay outcome truthfulness (2026-11-28)
- Offline outbox entries retain an explicit delivery state: queued, rejected, or uncertain. Transport failures and malformed/missing per-task acknowledgements are uncertain because the server may have committed the stable task ID before the response was lost; explicit per-task negative acknowledgements are rejected.
- Retries always reuse the original task ID. The API's AgentRun primary key plus owner/objective match is the idempotency boundary; an existing same-owner/same-objective run is returned rather than creating a second execution, while mismatched owner or objective reuse is rejected.
- Local records are removed only after an explicit positive acknowledgement for that exact task ID. Uncertain and rejected records remain retryable and are presented distinctly; worker execution state remains separate in task history.


### Offline task replay reconciliation (2026-11-28)
- Replay dispatch exceptions are reported as `uncertain`, never as definite rejection, because persistence may have committed before a connection failure.
- Authenticated `POST /api/agent/ops/tasks/reconcile` accepts batches of 1–20 stable task IDs plus objectives and queries only records owned by the authenticated user.
- Exact ID + matching objective confirms the existing run; same-owner objective mismatch is a conflict; missing or cross-owner IDs remain unresolved without disclosing another account's record.
- Local outbox entries are removed only after explicit exact-ID acceptance. Unresolved and uncertain entries remain retryable with the same task ID.


### Operator Console reconciliation wiring (2026-11-28)
- The reconnect flow now invokes exact-ID reconciliation for every replay item that was not explicitly accepted or definitively rejected by the sync response.
- A reconciliation response can clear an outbox record only when it explicitly confirms the same task ID; unresolved, missing, or failed reconciliation keeps the task locally retryable.
- Regression tests cover successful reconciliation after ambiguous dispatch and retention when exact-ID lookup remains unresolved.


## 2026-11-28 — CI completeness exact PR-head SHA repair

- Corrected `.github/workflows/ci-execution-completeness.yml` to resolve pull-request candidates from `github.event.pull_request.head.sha`, rather than `github.sha` (which is the synthetic pull-request merge ref for `pull_request` events).
- Manual `workflow_dispatch` runs continue to validate the selected workflow SHA.
- The candidate SHA is validated as a 40-character lowercase hexadecimal commit before checkout and is passed explicitly to the 19-context verifier.
- This repairs the false “all required contexts missing” result caused by comparing PR-head checks against a synthetic merge SHA. It does not waive any required check or certify a PR; all contexts must still complete successfully on the exact candidate SHA.
- Validation status: code change proposed; CI execution and exact-SHA green status remain pending.


## 2026-11-28 — Dialog focus tests use a DOM runtime

- The dialog keyboard-focus regression suite creates DOM nodes and asserts active-element behavior; the repository-wide Vitest default is Node.
- Added a file-scoped `@vitest-environment happy-dom` directive to `src/lib/dialogFocus.test.ts`. The existing `happy-dom` development dependency is already declared, so no dependency or lockfile change is required.
- This isolates browser-DOM requirements to the relevant UI test file without changing the environment for server-side Vitest suites.
- Validation remains pending on the PR head SHA.
## Render U2EB explicit deployment authorization

- Changed the primary `render.yaml` U2EB API, Web, and MCP services from CI-triggered automatic deployment to `autoDeployTrigger: off`. A passing CI run is necessary but does not itself authorize a provider deployment; the separate explicit PUSH DEPLOY gate remains required.
- Aligned the primary U2EB API health check with the live API liveness endpoint `/health` and the standalone U2EB blueprint.
- Updated deployment-contract assertions so automatic deployment cannot silently return to the primary U2EB blueprint.
- This is a source-controlled proposal only. It does not change Render's live service settings, trigger a deployment, consume build minutes, or authorize production changes. Validation must pass on the exact PR SHA before merge.


## 2026-11-28 — MCPJungle CI bearer-token environment repair

- The isolated gateway workflow wrote `MCP_AUTH_TOKEN` to the Compose `.env` file, but then expanded `$MCP_AUTH_TOKEN` in the runner shell without sourcing that file. Compose could read the value while the CLI received an empty `--bearer-token`, causing MCPJungle to attempt OAuth dynamic client registration and fail with `OAuth error: Not found`.
- The workflow now exports the disposable `.env` values into its own shell and fails immediately if `MCP_AUTH_TOKEN` is absent, before calling the registration CLI.
- No production credentials are read or changed; the fixture token remains CI-only. Runtime verification must pass on the exact PR SHA.


## 2026-11-28 — Operator Console offline-sync test contract

- The Agent API regression run on merge commit `014724fe9a69b02f6c55cb8ad165519cfc114c09` exposed a test-only mock defect: `replayOfflineTaskBatch` was mocked with no resolved value, while the component correctly consumes its `acceptedIds`, `rejectedIds`, and `error` outcome contract.
- Updated `src/pages/OperatorConsole.test.tsx` to return an explicit empty sync outcome from the mock before each test. This preserves the account-ownership assertion and prevents the test harness from simulating an impossible undefined sync result.
- No production behavior, provider configuration, database, credentials, or deployment state was changed. Validation is pending on this repair branch's exact SHA.


## 2026-11-28 — Stack validator fixture completeness

- The repository stack manifest correctly declares `Dockerfile.database` for its local PostgreSQL/pgvector service, and the Dockerfile exists in the repository. The validator test fixture omitted that file, so its positive-path test failed with a false missing-Dockerfile error.
- Added `Dockerfile.database` to the isolated fixture. The negative-path tests still exercise missing/unsafe paths through their own mutations; no production Dockerfile or deployment configuration changed.
- Exact-SHA CI rerun is required before this repair can be considered verified.


## 2026-11-28 — MCPJungle delegated-token registration and Render gate assertions

- The MCPJungle CI registration targeted the MCP proxy but supplied `MCP_AUTH_TOKEN`, which authenticates the MCP server itself. The Caddy proxy intentionally replaces the incoming Authorization header with the short-lived `MCP_PROXY_DELEGATION_TOKEN`; passing the server token to the gateway therefore produced an unauthorized proxy response and MCPJungle incorrectly attempted OAuth dynamic client registration.
- Registration now supplies the generated short-lived delegated JWT to `--bearer-token`, matching the Caddy proxy contract. The JWT remains limited to the `platform_health` scope and is generated only inside the disposable CI job. The MCP server's own token remains separate and is not passed to the proxy registration.
- Updated Render readiness-audit tests to match the committed U2EB Blueprint: `/health` is the configured health endpoint, and `autoDeployTrigger: off` preserves the explicit Push Deploy policy. No provider setting or live deployment was changed.
- Exact-SHA CI rerun is required; these code changes are not considered verified until the MCPJungle auth/ACL job and full required checks pass.


## 2026-11-28 — MCPJungle CI delegation claim completeness

- The gateway registration now correctly uses the short-lived `MCP_PROXY_DELEGATION_TOKEN`, distinct from the MCP server's own `MCP_AUTH_TOKEN`.
- A subsequent exact source audit found the CI JWT fixture still omitted `actorType`, which `mcp-server/delegation.js` requires and validates against `human`, `agent`, or `service`.
- Added `actorType: "human"` to the disposable CI-only JWT. The token remains HMAC-signed, short-lived, and restricted to the read-only `platform_health` scope.
- This is a CI fixture correction only. The MCPJungle authentication/ACL job and all required exact-SHA checks must pass before the repair is considered verified.
## 2026-11-28 — Landing Page health and navigation regression coverage

- Added a dedicated `happy-dom` page test for the Landing Page.
- Covered the API-connected state, pending health-check state, and API-failure guidance state.
- Asserted that the primary workspace, dashboard, and cockpit destinations remain available when the API is online or unavailable.
- The test mocks the platform-health hook so it does not depend on a live API or external service.
- Validation status: test source added; local execution and exact-head CI remain pending. This coverage addition does not change runtime behavior, authentication, API contracts, provider configuration, or deployment state.

## 2026-11-28 — Trading Terminal safety and navigation regression coverage

- Added page-level coverage for the default overview, Forex research state, Wallet deposit/withdrawal presentation, and Risk Center.
- Asserted that the terminal remains explicitly paper-only, does not imply live quotes, and keeps real-money funding/withdrawal actions disabled until a provider is connected.
- Asserted that risk limits are presented as server-enforced and that emergency-stop reset requirements remain visible.
- Mocked the paper-trading child panels to keep the page tests isolated from their own API and component contracts.
- Validation status: test source added; local execution and exact-head CI remain pending. No runtime trading, payment, API, authentication, or provider behavior was changed.
\n\n## 2026-11-28 — Complete Prisma AgentRun runtime schema gate\n\n- The earlier startup guard checked only the 18 base queue columns. A source-to-source audit found that Prisma and worker claim/approval flows also depend on 14 additional AgentRun columns, including the immutable approval hashes, plan snapshot, cancellation marker, model selection, trace context, and execution scope.\n- Expanded the authoritative `database.yml` AgentRun required-column contract to all 32 mapped Prisma columns. Expanded the read-only startup inspection to require the same 32 columns and added regression assertions for the approval-plan fields and full count.\n- The guard remains read-only; it performs no DDL and does not run migrations. No database, credentials, provider configuration, deployment, or production state was changed.\n- Exact-head CI and security checks remain required; this source change is not runtime or deployment certification.\n

## 2026-11-28 — Align migration audit with the full AgentRun contract

- Expanded the Prisma migration-readiness schema audit from 15 AgentRun columns to all 32 columns declared by the Prisma model, database.yml, and startup readiness gate.
- Expanded the complete-schema test fixture to all 32 columns so the audit cannot pass with a partial AgentRun table.
- This is source/test coverage only. Local execution and exact-head CI/security validation remain pending; no live database migration or deployment was run.


## 2026-11-28 — AgentRun operational index readiness audit

- Extended the read-only migration/schema audit to require the four AgentRun indexes used by queue selection, lease recovery, worker lease lookup, and approval filtering.
- Added regression assertions that a missing AgentRun operational index is reported and that the complete-schema fixture includes all required indexes.
- Local test execution and exact-head CI/security checks remain pending. No live database or deployment was changed.


## 2026-11-28 — Complete AgentRun index readiness parity

- Expanded the read-only Prisma migration-readiness audit to require all eight operational `agent_runs` indexes, matching the structural-contract audit and the migration definitions.
- Updated the readiness test fixture and missing-index assertions to cover the complete eight-index contract.
- The audit remains read-only; it does not create indexes or apply migrations.
- Verification is source-level only until the Node test suite and live database audit are executed.

- AgentRun index structural validation now explicitly rejects unique indexes where Prisma declares non-unique indexes, in addition to checking B-tree type, ordered columns, and absence of partial predicates. Regression coverage includes an unexpectedly unique `agent_runs_user_id_created_at_idx`.

## 2026-11-28 — Command Center mobile drawer integration coverage

- Added page-level `happy-dom` coverage for the Command Center mobile conversation-history and live-telemetry drawers.
- Verified modal semantics, close controls, focus restoration after close/Escape, and the single-active-drawer behavior when switching between history and telemetry.
- Kept the shared `trapDialogTabKey` helper isolated behind its existing utility tests; this page test verifies the actual Command Center state transitions and focus lifecycle.
- No runtime behavior, API contract, authentication, provider configuration, deployment, migration, or credential state was changed.
- Validation status: source committed on the repair branch; exact-head test execution is still required before this patch is considered verified.

## 2026-11-28 — PR CI catalogue and Docker scan producer alignment

- Updated CI execution completeness to select `required-staging-checks.json`
  for pull requests and non-main manual runs. Manual runs on main retain the
  release catalogue, keeping the main-only Render audit out of PR validation.
- Removed the Docker workflow's restrictive PR path filter. API/web image
  build and scan contexts now run for every pull request, including
  documentation-only and workflow-only changes. PR validation does not publish.
- The Railway source contract remains `railway.json`: Dockerfile builder with
  `Dockerfile.api`. The observed live Railway source/builder drift is not
  changed here; relinking or changing a live service requires authorization.
- No provider relink, live configuration change, production deployment,
  database operation, or credential change is included. Exact-SHA CI/security
  verification is required before any merge or deployment.
## 2026-11-28 — Studio canonical repository handoff repair

- Fixed the RyanAI Studio VS Code Web handoff to open the canonical repository `ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main` instead of the retired `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat` source.
- Added page-level `happy-dom` coverage for the repository handoff and Studio runtime boundary messaging.
- No backend, authentication, credential, deployment, database migration, or provider configuration changes.
- Exact-head CI/security execution remains required before this patch is considered verified.

## 2026-11-28 — UI integration resilience: GitHub provider refresh

- Preserved the last verified GitHub account/repository identity in the Plugin & Integrations centre when a later status refresh fails.
- Failed refreshes now mark the snapshot `unverified` instead of falsely replacing verified identity with `connected: false`.
- Added regression coverage for the refresh-failure path.
- No credential, provider configuration, backend, database, deployment, or production changes.

## 2026-11-28 — PhoneLink account-switch isolation

- Clear the previous mounted account's PhoneLink devices, capabilities, inbox events, pairing state, and transient messages when the authenticated `userId` changes.
- Reset the refresh generation and loaded-state marker so stale in-flight requests cannot repopulate the newly selected account's view.
- Added a regression test that switches the mounted PhoneLink workspace from one synthetic owner to another and asserts the prior owner's inbox event is no longer rendered.
- No native Android, backend, provider, credential, database, deployment, or production changes. Physical-device validation remains separate.

## 2026-11-28 — Operator Console account-switch isolation

- Clear task history, selection, offline outbox snapshot, refresh metadata, and transient messages when the authenticated app `userId` changes.
- Invalidate in-flight task-history and outbox reads and reset the current outbox owner/sync snapshot so prior-account data is not displayed while the next account loads.
- Added a regression test that holds the next account's task-history request open and verifies the previous account's task objective disappears immediately before the new response resolves.
- No backend, database, credential, provider, deployment, or production changes.


## 2026-11-28 — Operations Center account-switch isolation

- Clear prior-account task history, administrator approval actions, objective draft, confirmation/acting state, errors, and notices immediately when the authenticated app identity or admin UI scope changes.
- Invalidate outstanding task and approval reads and guard task-submission/approval mutation completions with an account-generation token so late responses from the previous identity cannot update the newly mounted account's UI.
- Added a deferred-response regression test proving previous task and approval content disappears while the next account's task and approval requests are still loading, then only the new account's results appear.
- Frontend-only isolation and stale-response safety. Backend authorization remains authoritative; no credentials, database, provider, deployment, or production state changed. Test execution and exact-head CI/security evidence remain pending.


## 2026-11-28 — RyanAI Comms account-switch isolation

- Clear the prior account's private conversation list, selected thread, channel configuration snapshot, draft message/recipient/subject, attachment selections, approval state, conversation intelligence output, filters, and transient notices when the authenticated app identity changes.
- Invalidate the previous refresh generation before the next account's Comms status and conversation requests run, preventing an older inbox refresh from repopulating the newly selected account's view.
- Added a deferred-response regression test: the previous owner's phone number and email conversation must disappear while the next owner's inbox is still loading; only the next owner's thread appears after its response resolves.
- This is a frontend privacy boundary; server-side owner authorization remains authoritative. Test execution and exact-head CI/security evidence remain pending. No dispatch, backend, database, credential, provider, deployment, or production state changed.


## 2026-11-28 — RyanAI Comms delivery-state presentation

- Replaced raw internal message-state strings in the conversation timeline and latest-status panel with explicit, user-readable distinctions for pending_send, in_flight, uncertain, accepted, sent, delivered, read, answered, suppressed, failed, bounced, undelivered, received, and processing.
- Provider acceptance is explicitly labelled as delivery-unconfirmed; uncertain outcomes instruct operators to reconcile before retrying; delivered/read labels require the corresponding provider receipt state supplied by the API.
- Added regression coverage that checks accepted, uncertain, and delivered remain distinct in the Comms UI.
- This is a presentation-only change; it does not manufacture receipts or alter AgentRun state. Test execution and exact-head CI/security evidence remain pending. No provider dispatch, backend, database, credential, deployment, or production state changed.


## 2026-11-28 — Comms dispatch receipt race protection

- Fixed a confirmed race in outbound dispatch state updates: a delayed provider-send response or timeout could previously overwrite a faster provider callback and downgrade an already delivered/failed dispatch.
- Acceptance and uncertainty updates now use conditional atomic updates; acceptance cannot overwrite terminal receipt states and uncertainty only applies while the dispatch is still in flight.
- Receipt advancement now uses atomic allowed-state predicates. Delivered evidence can supersede an earlier failed callback, while later accepted/failed callbacks cannot downgrade delivered or reconciled state.
- Added unit coverage for conditional acceptance, in-flight-only uncertainty, and atomic receipt transition predicates. No AgentRun fields are written by these dispatch-state functions.
- Test execution and exact-head CI/security evidence remain pending. No provider dispatch, database migration, credential, deployment, or production state changed.


## 2026-11-28 — Comms PA receipt event replay identity

- Reused the immutable CommsDeliveryReceipt UUID as the PA event ID instead of generating a fresh UUID for every Twilio webhook delivery.
- Authenticated provider retries can still re-emit evidence if a prior callback was persisted before a process interruption, but every replay now carries the same event identity so downstream consumers can deduplicate it.
- Added regression coverage for stable PA event identity across a repeated callback. Test execution and exact-head CI/security evidence remain pending; no provider dispatch, AgentRun state, database migration, credential, deployment, or production state changed.

## 2026-11-28 — Comms approval/receipt race reconciliation

- Closed a callback-ordering gap between the provider dispatch record and the separate owner approval record. A fast Twilio callback could be persisted before the approval row received its provider message ID; the callback would then update delivery evidence but miss the approval row, after which the delayed send response could leave the approval with stale provider status.
- Send finalization now reconciles the latest immutable receipt for the provider message before finalizing the approval. The callback path likewise derives approval status and provider status from the latest receipt, allowing later delivered evidence to supersede an earlier failed callback without letting an older callback downgrade the current state.
- Approval status remains a coarse authorization/dispatch lifecycle; detailed provider delivery events remain append-only in `CommsDeliveryReceipt`. AgentRun state is not modified.
- Added regression assertions for receipt-based reconciliation. Test execution and exact-head CI/security evidence remain pending. No provider dispatch, migration, credential, deployment, or production state changed.

## 2026-11-28 — Comms idempotency provider binding

- Tightened outbound dispatch replay validation so an idempotency key cannot be replayed against a different provider, even when message, recipient, channel, and AgentRun attribution match.
- The existing reservation lookup now retrieves and compares the provider as part of the immutable dispatch identity.
- Added a regression case for cross-provider idempotency-key reuse.
- Validation status: regression test authored; execution remains pending.

## 2026-11-28 — Comms approval expiry projection

- Corrected the owner approval-status read path so a pending approval whose expiry timestamp has passed is presented as `expired`, rather than remaining visually pending until another write happens.
- This is a read-time projection only: it does not mutate approval rows, and it does not expire or interrupt an already-claimed `dispatching` action.
- Added pure-function regression coverage for pending, unexpired, dispatching, and accepted states.
- Validation status: regression test authored; execution remains pending.

## 2026-11-28 — Comms conversation delivery projection

- Extended the owner-scoped conversation-history read to include the outbound dispatch's monotonic state and the latest append-only provider receipt details.
- The API exposes additive `deliveryStatus`, `deliveryProviderStatus`, and `deliveryOccurredAt` fields. Dispatch state remains the authoritative lifecycle projection; receipt details are evidence, not a mutable replacement for the receipt log.
- Updated the Comms timeline and latest-status panel to show the dispatch projection and provider-reported status while preserving the original communication-message `status`.
- Added a route regression test confirming that delivered evidence is visible even when the legacy message status remains `accepted`, and that the read path does not mutate communication messages or AgentRun state.
- Validation status: regression test authored; execution and exact-head CI/security verification remain pending. No provider dispatch, AgentRun mutation, migration, credential, deployment, or production state changed.

## 2026-11-28 — Comms dispatch-state UI contract alignment

- Aligned the Comms status-label map with the actual outbound dispatch lifecycle values: `reserved`, `dispatching`, and `reconciled`, in addition to existing provider and delivery states.
- The message timeline now shows the provider receipt occurrence time separately from the original communication-message creation time.
- Added a component regression test for the three dispatch-only states and provider receipt timestamp visibility.
- Validation status: test authored but not executed; exact-head CI/security checks remain subject to verification. No dispatch, provider, AgentRun, migration, credential, or production state changed.

## 2026-11-28 — Comms provider callback lifecycle semantics

- Prevented `queued` and `unknown` provider callbacks from promoting an outbound dispatch to `accepted`; these callbacks remain append-only evidence without claiming provider acceptance.
- Kept voice `completed` mapped to `accepted_by_provider`, not `delivered`. A completed call is not proof that a recipient heard or read the message.
- Added regression tests for queued/unknown no-op transitions and voice completion advancing only to accepted dispatch state.
- Added explicit UI labels for queued, unknown, and accepted-by-provider states.
- Validation status: tests authored but not executed; exact-head CI/security verification pending. No provider dispatch, AgentRun mutation, migration, credential, deployment, or production state changed.
## 2026-11-28 — UI and integration regression repair

- Updated mobile Command Center drawer tests to wait for Framer Motion exit completion before asserting the dialog has left the DOM; focus restoration assertions remain in place.
- Aligned the Operator Console account-switch loading assertion with the rendered loading label while retaining the check that account A task history is removed immediately.
- Tightened the database inspection read-only assertion to match standalone DDL keywords, avoiding false positives on identifiers such as `created_at`.
- Made the plugin registry refresh test deterministic by keeping the initial registry snapshot successful until the explicit refresh action, then simulating a transient failure.
- Preserved the last known GitHub identity during a failed status refresh and surfaced the backend error as an accessible alert instead of silently discarding the failure detail.
- No provider configuration, credentials, production data, database migrations, deployments, or release settings were changed. Exact-SHA CI and security checks must pass before any merge or deployment.


## 2026-11-28 — Integration initial-load race and deterministic drawer tests

- Removed the zero-delay timer around initial plugin registry, provider-connection, and GitHub status reads. The deferred initial read could race a user-triggered refresh and overwrite a newer verified snapshot or error state.
- Initial status requests now start immediately on mount; request-generation guards still prevent stale responses from updating state after newer requests or unmount.
- Mocked Framer Motion's presence/transition layer in Command Center component tests so drawer open/close, Escape handling, and focus restoration are tested deterministically without depending on browser animation-frame completion. Production animation behavior is unchanged.
- Exact-SHA CI must verify these corrections; no production/provider configuration, credentials, database migrations, deployment, or release settings were changed.


- Follow-up test correction: the GitHub identity-refresh regression now clicks the GitHub card's own Refresh control, not the separate registry/connection refresh control. The latter does not invoke /api/github/status.
- The Framer Motion test double strips animation-only props from the rendered DOM while preserving ordinary dialog props and refs.

## 2026-11-28 — Comms out-of-order callback protection

- Kept the monotonic outbound dispatch state authoritative when reconciling send approvals: a late `failed` receipt cannot reverse a dispatch already confirmed as `delivered`.
- Retained append-only receipt history and latest-received callback details for operator inspection; receipt ordering remains based on provider event time when explicitly supplied, otherwise database receipt time.
- Added callback SQL regression assertions for the delivered-dispatch guard.
- Validation status: tests authored but not executed; exact-head CI/security verification pending. No provider dispatch, AgentRun mutation, migration, credential, deployment, or production state changed.

## 2026-11-28 — Inbound Comms owner and provider-event isolation

- Removed implicit owner reassignment from the channel/address conversation upsert.
- Added a conditional ownership claim: an unowned legacy conversation can be claimed once, while a conversation already assigned to another owner cannot be transferred by an inbound webhook.
- A globally duplicated provider event ID is accepted as a replay only when the existing message has the same owner, channel, and body. Reuse across owners, channels, or changed content is rejected.
- Added regression coverage for owner-transfer prevention, cross-owner provider-ID collision, and changed-content collision.
- Validation status: tests authored but not executed; exact-head CI/security verification pending. No inbound provider request, outbound reply, AgentRun mutation, migration, credential, deployment, or production state changed.
