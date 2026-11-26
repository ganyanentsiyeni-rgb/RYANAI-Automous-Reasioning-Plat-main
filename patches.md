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
- OpenRouter remains optional and runtime-disabled pending the remaining unified-routing, catalogue, usage/cost, reliability, privacy, and staging acceptance gates. No provider key, billing, hosted environment, deployment, migration, or external API call was changed.


## 2026-11-26 — Logic OpenRouter override routed through API gateway

- Replaced the Logic override's direct `ChatOpenAI` construction and direct endpoint/key resolution with `resolveSelectedReasoningModel` backed by the canonical provider registry and `invokeConfiguredProvider` shared API-owned adapter.
- The worker now requires a persisted approved AgentRun, revalidates its current worker lease immediately before provider dispatch, and evaluates Gen-X using the internal `approvedAgentRun` context. The worker-only context is distinct from route-only `ownerAuthorized` and is never accepted from model/tool input.
- The API MCP gateway and approved AgentRun worker now share the same provider request shaping, server-held credential resolution, HTTPS/allowlist checks, normalized text response, usage normalization, and no-tool-execution behavior.
- Existing `gpt-4o` and `gpt-4o-mini` selections continue to use the configured Logic provider. Only the two explicitly catalogued OpenRouter aliases may select the OpenRouter route.
- Added model selection, provider invocation, and Gen-X policy regression tests. Exact-head CI is still required; tests have not been executed locally in this workflow.
- OpenRouter remains runtime-disabled. No provider API request, secret/billing change, hosted configuration change, merge, migration, or deployment was performed.
