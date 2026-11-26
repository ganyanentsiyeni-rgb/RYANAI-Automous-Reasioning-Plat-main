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
