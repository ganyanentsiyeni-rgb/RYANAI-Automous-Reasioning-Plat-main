# RyanAI Architecture — Shared PA, Darkside Copilot, Comms and Release Control Plane

**Status:** architecture addendum. Source code, workflow definitions, schema, provider records, and exact-head CI evidence remain authoritative.

## 1. Shared responsibility model

PA Agent and Darkside Copilot are two operator surfaces over the same governed PA responsibility and capability model. The Admin Console exposes administrative controls over that same model.

The UI does not grant authority. The server validates identity, owner scope, capability scope, and Gen-X policy before execution.

## 2. Comms integration

Comms is part of the shared control plane. A PA objective can create a new durable internal Comms child task directly from the objective; an existing Comms conversation is not a prerequisite.

The child task is:

- owner-scoped;
- idempotent;
- linked to the parent PA delegation;
- internal-only;
- suitable for status/result reporting.

It cannot be treated as proof of outbound delivery.

## 3. Release orchestration

The governed deployment sequence is:

1. PA or an authorized operator requests PUSH DEPLOY.
2. The release request identifies the exact 40-character candidate SHA.
3. The workflow confirms that SHA is the current main commit.
4. All required CI/CD and security checks for that exact SHA must complete successfully.
5. Only then do the Render, Railway, and Vercel jobs start.
6. The three provider jobs are independent.
7. Each provider records deployment identity/status, source SHA, and runtime health.
8. The durable internal Comms task reports the separate outcomes.

One provider's result never substitutes for another provider's result.

## 4. Provider independence

Render, Railway, and Vercel are mandatory release targets for this control plane. A failure or provider block is reported against that provider while the other provider jobs remain independently eligible after the common gate.

The overall release is successful only when all required provider deployment and health checks succeed.

## 5. Comms message routing

The future routing tags @RyanAI, @PA Agents, @Comms, @Security, @updates, and @self-patches identify routing intent only.

A message-trigger adapter must still enforce authentication, owner scope, idempotency, exact-SHA resolution, the explicit PUSH DEPLOY command, and the same CI/security gate. Until that adapter is implemented and verified, tagged messages must not be interpreted as deployment authorization.

## 6. Evidence and safety

A workflow-dispatch receipt means only that GitHub accepted the workflow request. It does not mean CI passed or deployment completed.

Evidence must distinguish:

passed / failed / queued / skipped / cancelled / missing / provider-blocked.

No production deployment, production migration, secret mutation, paid upgrade, or external communication is authorized by this document.

## 7. AI Inspector and specialist handlers

The AI Inspector has a dedicated module owner, `ai-inspector-module-agent`, and task types `ai-inspector.audit` and `ai-inspector.report`. PA can route inspection objectives to the repository-auditor specialist. The Inspector returns structured, evidence-file-linked findings as the durable Studio task output; the CI workflow separately writes `reports/ai-inspector-audit.md` and uploads it as an artifact.

The specialist worker process registers bounded handlers per profile. Security, infrastructure, data/queue, provider, communications, frontend/accessibility, and release handlers perform read-only static inspections. Provider configuration presence is never represented as live provider health. Runtime verification remains `not_performed` unless independently supported by fresh runtime evidence. The coordinator proposes a plan only; it has no execution authority.

The `ci-diagnostics` worker profile uses a shared registration function in both supported Studio worker entrypoints. It binds `ci-failure`, `test-failure`, and `build-failure` to the same task handler, which uses the persisted Studio task owner, requires explicit `read-workflow-runs` and optional `read-job-logs` capabilities, forwards cancellation, and returns provider-blocked evidence when GitHub inspection cannot be completed. Handler registration readiness is not a worker heartbeat or proof of live execution.


The 13 module agents and 10 specialist worker profiles are registry contracts, not live-runtime assertions. A worker is live only when a real process has a fresh healthy persisted heartbeat and its task/lease execution evidence is available. CI diagnostics remains bound to connected GitHub workflow evidence. No handler can approve, merge, deploy, migrate production, mutate secrets, or send external communications.

## 8. Specialist handler integrity and report semantics

The specialist handler module is a single, syntactically valid registry of profile-specific handlers. The repository-auditor process retains ownership of repository inventory tasks; the shared specialist registrar adds only AI Inspector audit/report task types and documentation inspection, preventing duplicate registration. Evidence traversal is repository-root confined, depth/file/size bounded, cancellable, and read-only.

AI Inspector exit code `1` is the audit's documented signal that critical/high findings exist. It is not an execution crash: PA receives the complete report, digest, source, exit code, and evidence reference so it can triage the findings. Empty reports, unsupported exit codes, oversized reports, failed authorization, or lost leases cannot be recorded as a successful inspection. A passed capability receipt means the inspection completed and its report was durably recorded; it does not mean the report contains no findings.

## AI Inspector module contract

`ai-inspector-module-agent` is the single accountable module owner for AI Inspector & Audit. The module maps `ai-inspector.audit` and `ai-inspector.report` to the repository-auditor execution worker while preserving a distinct module identity and responsibility. PA invokes the Inspector behind the Gen-X `ai-inspector.inspect` authorization boundary. The resulting report is persisted as append-only AgentRun evidence; PA receives the report text, source metadata, inspection evidence paths, findings, exit code, and SHA-256 digest.

Inspection combines the dedicated audit script with bounded, repository-root-confined static checks for TLS verification, workflow permissions, migration/startup coupling, Gen-X authorization hooks, worker lease primitives, provider adapter lifecycle, and Comms safety indicators. Findings do not certify runtime health or provider authentication. High-severity findings are preserved as report evidence (exit code 1) rather than discarded. Empty output, unsupported execution failures, missing authorization, or lost leases fail closed.

## Worker handler readiness invariant

A worker profile is startable only when every task type declared in `RYANAI_WORKER_ROSTER` has a registered handler in that worker process. Readiness returns the complete supported, registered, and missing task-type lists; partial registration is not healthy. Worker bootstrap modules own their unique task registrations so shared specialist registration cannot double-register a task. This is process-local handler readiness only; live worker availability still requires a fresh authenticated heartbeat and durable queue evidence.

## Repository inventory execution boundary

Repository inventory task handlers are registered by the typed specialist handler module and are available to both server-managed and CLI worker bootstraps. Inventory is bounded by repository-root confinement, maximum recursion depth, file count, and per-file size; it does not execute discovered scripts or read environment values. The standalone Node inventory command remains an independent read-only utility. Server TypeScript modules must not import the `.mjs` command entrypoint, which can cause TypeScript to emit over an input file (`TS5055`).


## 9. PA sourced skill registry

PA has a governed sourced-skill registry at `src/skills/paSourcedSkills.ts`. It converts useful external patterns and approved project skills into bounded PA capabilities with explicit provenance, capabilities, risk, execution mode, and enabled state.

The initial active set includes:

- research and source verification;
- observability and synthetic verification;
- correction-to-guardrail proposals;
- Supabase database governance;
- edge security advisory review;
- incident evidence and recovery.

Provider/model routing remains catalogued but runtime-disabled while the resumed OpenRouter implementation completes its remaining catalogue, usage/cost, reliability, privacy, regional-data, and staging acceptance gates. The Logic override now routes through the shared API-owned provider adapter only after a persisted approved AgentRun and live worker lease are revalidated by the API worker. A registry entry is not an external integration or permission grant. Active skills remain read-only or proposal-only and must continue through the existing Gen-X, AgentRun, evidence, and execution boundaries.


## Owner access and dashboard workspace preferences

The Supabase-verified account `rmnganyane@gmail.com` is the canonical RyanAI owner. The API resolves that verified email to both `isOwner: true` and `role: admin`; the optional `RYANAI_OWNER_EMAIL` may designate an additional owner but cannot displace the canonical owner. Browser-editable user metadata is never an authorization source.

The fourteen Dashboard UI options control navigation and dashboard-shortcut visibility only. Settings remains available. Hiding a workspace does not revoke its server-side permission, and enabling a preference does not grant access. Admin Console and RyanAI Communications retain their separate verified administrator/owner authorization checks. Desktop and mobile navigation use the same visibility rules.

This change is delivered through a reviewable pull request. It does not authorize production deployment, database migrations, credential changes, or a bypass of required CI/security checks.


## Frontend navigation and dashboard preferences

The account preference record is a presentation setting consumed by both desktop/mobile navigation and Dashboard shortcuts. Settings is deliberately not user-hideable. The Dashboard option controls its navigation shortcut. A hidden workspace may still be reached by a direct route when the authenticated account is otherwise authorized; the API and route guards remain the security boundary. Visibility preferences never grant Admin, Owner, or other privileged capabilities.


## Frontend trust and operational API boundary (2026-11-26)

Vite build configuration and browser runtime share `src/config/frontendEnv.ts` as the frontend environment policy. It rejects server-only credentials exposed through `VITE_*`, allows only the named public Supabase anon/publishable keys, and requires HTTPS non-loopback API origins for staging/production. The legacy `VITE_API_URL` alias remains temporarily accepted; `VITE_API_BASE_URL` is canonical.

`src/hooks/useRyanOperations.ts` is an authenticated UI adapter over the existing Agent Operations routes. It does not synthesize successful task creation or approval state. Task/awareness/PA telemetry is fetched independently so a failed observer does not erase another observer's last confirmed snapshot. Active task polling stops when all observed runs are terminal.

The detailed multi-subsystem health, fixed 12-agent/10-worker registry, five-stage MCP tool verification, complete Comms receipt state machine, and backend capabilities manifest are not represented as live frontend contracts until corresponding API endpoints and backend runtime schemas exist. Frontend types must describe confirmed backend payloads, not create an apparent implementation by declaring interfaces alone.

The focused frontend contract tests, explicit production web build, and compiled-bundle audit are integrated into the existing pull-request CI job for pre-merge execution. The standalone workflow becomes independently active once merged into the base branch. Merge remains governed by the existing required exact-SHA CI/security checks and independent review; production deployment remains behind the explicit Push Deploy trigger and the independent Render/Railway/Vercel release jobs.


## PA delegation frontend dispatch boundary (2026-11-26)

The shared `PADelegationPanel` creates delegations through `useRyanOperations`, which sends the authenticated request to the existing `/api/agent/ops/pa/delegations` route. The panel's fingerprinted UUID is carried as the backend `delegationId` so retries retain the same request identity. UI acceptance requires the backend's persisted delegation and AgentRun references plus its explicit approval state. Gen-X policy evaluation, owner scoping, approval recording, and execution authorization remain server-side.


## Admin Console capability metadata boundary (2026-11-26)

The Admin Console's plugin capability catalogue reads the authenticated, read-only `GET /api/plugins/registry` endpoint. It renders provider manifest metadata, declared capability risk and approval requirements, data classifications, and adapter registration status. The route deliberately excludes connection state, credentials, and executable adapter instances. A manifest entry or registered adapter is not a user permission, live provider health, or execution authorization. Gen-X policy and the server-side connection/adapter execution gateway remain authoritative; unavailable or malformed metadata is shown as an error rather than synthesized state.
## Command Cockpit AgentRun observability

The Command Cockpit's AgentRun queue panel is a read-only view over the authenticated task-list and operational-awareness endpoints through `useRyanOperations`. Queue counters, task statuses, and approval states are displayed only when returned by the API. Missing fields remain explicitly unreported; an empty list is not treated as proof of queue health. Active-run polling is bounded to the hook's observed non-terminal tasks. The panel does not approve, dispatch, claim, renew, or recover tasks; those operations remain backend-authorized and lease-controlled.


## 4. Optional cloud staging lanes

AWS ECS/Fargate and Azure AKS are optional, independently operated staging lanes. They do not alter the existing Render/Railway/Vercel PUSH DEPLOY release contract.

Both lanes are manual-only and fail closed unless (a) the provider deployment flag is enabled, (b) a separate staging-isolation confirmation is enabled, (c) the dispatch explicitly selects STAGE, (d) the candidate is the exact head of an open PR, and (e) the required CI/security checks for that exact SHA have completed successfully.

AWS uses GitHub OIDC to assume a scoped IAM role, pushes an immutable SHA-tagged API image to ECR, updates an ECS service from a repository task-definition template, waits for ECS stability, and checks the staging API `/readyz` endpoint.

Azure uses workload federation through Azure Login, pushes an immutable SHA-tagged API image to ACR, applies a configured AKS Kustomize overlay, updates a named Kubernetes Deployment container, waits for rollout, and checks the staging API `/readyz` endpoint.

Each provider emits independent run, candidate SHA, image URI, rollout and health evidence. Neither cloud lane provisions infrastructure, changes secrets, runs migrations, or deploys to production. Provider identity trust, least-privilege permissions, registry resources, task definitions/manifests, staging network isolation and environment protection must be provisioned and reviewed separately before enabling either lane.
## Admin Console AI Inspector evidence visibility

The Admin Console's AI Inspector panel reads the existing authenticated `GET /api/agent/ops/tasks` response, which returns owner-scoped AgentRuns with persisted evidence records. It selects only `pa.capability.executed` events whose payload capability is `ai-inspector.inspect`, then validates report text, source, digest format, and exit code before rendering. Exit code 1 remains a completed report with findings; exit code 0 is only reported as exit code 0 and is not a clean-audit certification. Missing, malformed, and unavailable evidence are distinct. The view does not start tasks, mutate evidence, verify the hash chain, or authorize execution/remediation.


## Optional AWS and Azure staging lanes

AWS ECS/Fargate and Azure AKS are optional, independently operated staging lanes. They do not alter the existing Render/Railway/Vercel PUSH DEPLOY release contract.

Both lanes are manual-only and fail closed unless (a) the provider deployment flag is enabled, (b) a separate staging-isolation confirmation is enabled, (c) the dispatch explicitly selects STAGE, (d) the candidate is the exact head of an open PR, and (e) the required CI/security checks for that exact SHA have completed successfully.

AWS uses GitHub OIDC to assume a scoped IAM role, pushes an immutable SHA-tagged API image to ECR, verifies the ECS service is active and explicitly tagged `Environment=staging`, updates the service from a repository task-definition template, waits for ECS stability, and checks the HTTPS staging API `/readyz` endpoint.

Azure uses workload federation through Azure Login, pushes an immutable SHA-tagged API image to ACR, applies a configured AKS Kustomize overlay in a staging namespace, updates a named Kubernetes Deployment container, waits for rollout, and checks the HTTPS staging API `/readyz` endpoint.

Each provider emits independent run, candidate SHA, image URI, rollout and health evidence. Neither cloud lane provisions infrastructure, changes secrets, runs migrations, or deploys to production. Provider identity trust, least-privilege permissions, registry resources, task definitions/manifests, staging network isolation and environment protection must be provisioned and reviewed separately before enabling either lane.


## Docker API and worker image parity (2026-11-26)

The root multi-target `Dockerfile` and standalone `Dockerfile.api` are separate build entrypoints for the API runtime. Their security and startup contracts must remain aligned: system/Supabase CA roots, strict certificate validation wrapper, non-root execution, liveness healthcheck, init process, and the optional non-blocking startup backup before the API launcher. The standalone API file also provides a `studio-worker` target; it must remain behaviorally aligned with the root Dockerfile worker target. Static deployment-contract assertions guard the declared directives and required copied artifacts. They do not substitute for successful image builds or live runtime checks.


## Docker Compose startup and optional gateway boundary (2026-11-26)

The local Compose API starts only after the disposable local PostgreSQL and Redis healthchecks pass. Web and MCP start after API health; their probes remain role-specific. The one-shot Prisma migration service is explicitly profile-gated and targets only the local Compose database; API startup must not execute DDL. MCPJungle and Cloudflare edge services remain opt-in profiles and are not part of the default stack. MCPJungle database credentials are mandatory rather than silently defaulting to an empty password. Static contract checks protect these declarations but do not replace Compose config validation or runtime startup tests.


### Compose health semantics follow-up (2026-11-26)

API `/livez` and `/health` report process liveness independently of PostgreSQL/Redis availability; `/readyz` evaluates live dependencies and agent queue/checkpointer readiness. Compose uses liveness to avoid restart loops during dependency recovery. MCP's own `/health` is a process probe, while its platform-health tool targets API `/readyz` for dependency status. The local migration profile's `DATABASE_URL` points to the Compose PostgreSQL service only. Both MCPJungle database initialization and gateway connection require the same non-empty password.


### AWS and Azure staging release gates (2026-11-26)

AWS ECS and Azure AKS staging workflows require the complete configured exact-commit CI/security check set before any cloud authentication, image publication, or workload mutation. Deployment remains disabled unless the explicit staging confirmation and provider-specific staging-isolation flags are enabled. OIDC and runtime `/readyz` verification remain required. These controls do not replace GitHub branch rulesets and no cloud deployment is initiated by the gate patch.
### Manual release gate (2026-11-26)

The manual staging/production release workflow now has a fail-closed exact-SHA preflight. It confirms the candidate is current `main` and requires the full configured CI/security check set to be present and successful before either release job can start. Production migration approval remains separate. This workflow-level guard is defense in depth and does not replace restoring GitHub branch ruleset required checks and approval requirements. Pending or missing checks block release; no deployment is initiated by the preflight.


### Exact-SHA latest-attempt check semantics (2026-11-26)

The governed release, AWS ECS staging, and Azure AKS staging workflows share one required-check catalogue and validator. For each required check name on the exact candidate commit, the validator selects the newest check run by `started_at` (using the monotonically increasing check-run ID as a tie-breaker). It evaluates only that latest attempt: completed success passes; missing, pending, cancelled, failed, skipped, or SHA-mismatched latest attempts block. A prior failed attempt is superseded only by a newer successful attempt. Automated unit tests cover these semantics. This workflow-level control does not replace GitHub branch protection or establish that CI has passed.

## CI execution evidence boundary

Release checks are an execution contract. The canonical `scripts/ci/required-release-checks.json` catalogue names the contexts that must actually execute for a candidate SHA. The `CI execution completeness` workflow polls GitHub check runs for that exact SHA and requires the newest attempt for every catalogue context to complete successfully on the same SHA. This prevents a green-looking release gate caused by stale, missing, pending, or differently-SHA check evidence.

The completeness workflow is evidence-only: it does not deploy, publish images, perform shared/production migrations, change credentials, or modify branch protection.

## Canonical CI release-check producer inventory (2026-11-26)

The release evidence contract now has a canonical producer inventory at `scripts/ci/required-release-check-producers.json`. Each required context has one declared workflow producer and job ownership. A CI validation script rejects duplicate contexts, missing workflow files, undeclared context names, and drift from `required-release-checks.json`.

The manual PUSH DEPLOY gate consumes this inventory rather than carrying a second hard-coded list. Image-security contexts are now independently produced by Docker CI: `Scan api image` and `Scan web image` build non-published images and scan them with Trivy for HIGH/CRITICAL vulnerabilities. These scans are evidence only; they do not publish or deploy images.

The producer inventory is an architectural control against duplicate or phantom release checks. CI must still execute and complete successfully on the exact candidate SHA before deployment or production migration is eligible.
## Release-gate validator normalization (2026-11-26)

Render staging, Railway staging, production database migration, and guarded Render repair now use the same canonical latest-attempt/exact-SHA validator as the other governed release lanes. This removes divergent subset check lists from those workflows and makes the 19-context release evidence contract authoritative across release and repair paths.

The validator only reads GitHub check-run evidence; it does not deploy, migrate, publish images, modify credentials, or change branch rulesets.



## Application layer integrity contract (2026-11-26)

RyanAI's logical application architecture is documented in `docs/architecture/RYANAI_APPLICATION_LAYER_INTEGRITY.md`. It defines eight layers—experience, application/API, identity/security/governance, orchestration/workforce, reasoning/intelligence, tools/integrations, data/persistence, and runtime/platform—plus their authority, dependency and evidence rules. The read-only `scripts/audit-application-layers.mjs` tool inventories layer roots and relative-import topology; it does not execute code, read environment values, make network calls, or prove runtime health. Cross-layer edges are review evidence, not automatic defects. No speculative module moves or production changes are part of this baseline.


## Studio task approval evidence (2026-11-26)

Studio-native owner approval is bound to a versioned SHA-256 digest of the exact execution-relevant task content: task/project/owner identity, title, objective, task type, priority, required capabilities, assigned worker, dependencies, and input. The digest is recorded in the append-only `task.human_approved` event. At worker admission, Gen-X `REQUIRE_APPROVAL` is satisfied only when the latest owner event contains the supported digest version and the digest matches the currently claimed task. Legacy, malformed, missing, or stale approval evidence fails closed. Gen-X `DENY` cannot be overridden by owner approval. Runtime status, lease fields, timestamps, attempts, and task output are intentionally excluded from the digest. This contract uses the existing JSON event payload and does not require a database migration.


## Self-Patch owner review-request issuance (2026-11-26)

The authenticated owner may open a pending review request through `POST /api/engineering/self-patch/review-approvals`. The API requires the canonical GitHub App installation to read the current PR, and accepts only an open PR targeting `main` whose head repository is the canonical RyanAI repository. It stores the exact observed head SHA and a 15-minute expiry in `github_pr_review_approvals`. Gen-X's `GX-SELF-PATCH-REQUEST-001` authorizes creation of this pending request record only; it is not authorization to submit a GitHub review, merge, deploy, or promote a patch.

Issuance creates an owner-scoped, idempotent internal Comms AgentRun for PA to coordinate the decision. The task explicitly prohibits external provider dispatch. If Comms task creation fails, the approval row is marked `blocked`. The inbound WhatsApp approval handler continues to reject `APPROVE` while independent Gen-X authorization evidence is unavailable. The promotion rule remains `REQUIRE_APPROVAL`. This is a request-issuance capability, not a completed approval-to-GitHub-review lifecycle.

### Exact-SHA staging versus release evidence

The exact-SHA evidence contract uses separate check catalogues for different lifecycle gates. scripts/ci/required-staging-checks.json contains only contexts that can execute on an open PR head. scripts/ci/required-release-checks.json remains the main/release catalogue and may include main-only checks such as the read-only Render API configuration audit. Render and Railway isolated staging workflows consume the PR-staging catalogue; release enforcement continues to use the main/release catalogue. This prevents a main-only producer from making a PR staging gate permanently impossible while preserving the stronger release evidence contract.

Docker PR image builds/scans also trigger when deployment-readiness scripts change, including scripts/readiness-audits.node-test.mjs and scripts/validate-deployment-contracts.mjs, so the required API/web image-scan contexts are actually producible for those changes.



## Agent UI approval presentation boundary (2026-11-28)

The app-owned Agent UI approval prompt is a presentation-level confirmation only. It places initial focus on the non-approving Decline action, traps keyboard Tab navigation within the dialog, treats Escape as decline, restores focus to the invoking control, and exposes the requested action summary through the dialog's accessible description. The prompt does not grant server-side authority: authenticated backend authorization remains authoritative for every consequential action. Exact-head tests and CI/security evidence are required before release.


## PA Agent identity presentation and compatibility (2026-11-28)

The user-facing collaboration identity is presented as **PA Agent** across Profile Settings, Darkside Copilot, delegation controls, and neural identity components. Existing persisted preference key `showAlexStatus`, the internal neural identity lookup key `alex`, and backend handoff identifiers are retained as compatibility contracts; they must not leak into user-facing labels. This presentation-only naming alignment does not rename API fields, database values, authorization actors, or persisted records. Exact-head tests and CI/security evidence remain required before release.


## Command Center mobile drawer interaction boundary (2026-11-28)

The mobile conversation-history and live-telemetry drawers are mutually exclusive app-owned modal surfaces. Their triggers expose `aria-controls` and `aria-expanded`; opening a drawer closes the other. Keyboard Tab navigation wraps in both directions, a focus-in guard prevents focus escaping the active modal, Escape closes the drawer, and dismissal restores focus to the invoking trigger. The shared `src/lib/dialogFocus.ts` helper is covered by unit tests. These are frontend accessibility behaviors and do not change conversation, telemetry, or authorization contracts.


### Operator Console offline outbox account-switch safety (2026-11-28)
- Scoped outbox reads and sync UI updates to the account and request generation that initiated them; late IndexedDB/network completions are ignored after an auth-account change.
- Clear prior-account queue/error presentation on account changes and filter rendered records by the active owner as a final UI boundary. Existing stable task IDs and server acceptance rules remain unchanged.
## Operations Center approval freshness (2026-11-28)

Administrator approval actions are executable side effects and must be based on a successfully refreshed queue. When an approval refresh is in progress or fails, the UI hides previously loaded actions and does not offer review, approve, or reject controls against stale queue data. The UI explains that the prior queue is hidden until it can be verified. This is a presentation safety guard, not an authorization boundary; backend administrator checks remain authoritative.
## PhoneLink refresh and partial-failure behavior (2026-11-28)

PhoneLink loads the device registry and capability catalog as its primary refresh operation, while the Comms event inbox is handled as a separately recoverable subrequest. Inbox failure must not erase the last known events or be represented as a confirmed empty inbox; the UI retains stale-but-known events, exposes an accessible inbox error, and offers retry. Successful inbox refresh clears that error. The initial device loading placeholder is shown only until the first refresh completes; periodic polling must not replace an already rendered device list with a transient loading state. These rules preserve truthful partial-data presentation without changing API contracts.


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


## 2026-11-28 — Exact-SHA CI completeness

The CI completeness workflow resolves the candidate commit differently by trigger: pull requests use `github.event.pull_request.head.sha`; manually dispatched runs use the selected workflow SHA. It validates the 40-character SHA, checks out that exact commit, and supplies the same value to the required-context verifier. This avoids comparing check runs attached to a PR head with GitHub's synthetic merge commit. The verifier still requires every catalogued context to complete successfully on that exact SHA; this workflow change is not release certification.
