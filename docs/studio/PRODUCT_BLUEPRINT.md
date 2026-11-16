# RyanAI Studio — Product and Architecture Blueprint

## Product identity

RyanAI Studio is the independent workspace for creating, engineering, researching, designing, testing, and delivering projects across the RyanAI platform. It owns the project lifecycle and user experience. Jarvis is one compatible orchestration adapter, not the Studio runtime or a required UI dependency.

## Core navigation and UI surfaces

1. **Home / Mission Control** — portfolio overview, recent work, pinned projects, inbox, milestones, blockers, active runs, and system health. Separate project state, worker availability, provider connectivity, and verified completion.
2. **Project Foundry** — guided intake for software, research, product, design, data, automation, content, and operations projects. Include templates, objectives, scope, deliverables, acceptance criteria, constraints, budget ceilings, and risk classification.
3. **Project Workspace** — overview, task graph, timeline, files, notes, decisions, artifacts, collaborators, activity, and audit trail. Version every artifact and link it to the task/run that produced it.
4. **Task Graph / Orchestration** — dependency DAG, parallel workstreams, task ownership, retry state, checkpoints, leases, cancellation, and blocked-by relationships. Task types include research, implementation, design, review, test, security, documentation, and delivery.
5. **Workforce Studio** — specialist directory with capability cards, supported task types, tool requirements, availability heartbeat, current load, quality history, and permitted actions. Assemble project squads by capability; roster membership is never proof of live availability.
6. **Engineering Workbench** — repository and branch context, exact base SHA, patch editor, diff review, test plans, CI/security evidence, artifact downloads, and human approval. Remote worker execution is separate from approval; no automatic merge or deployment.
7. **Research Lab** — research briefs, source collection, source quality, publication dates, claim-to-source links, evidence matrix, contradiction tracking, confidence, and exportable reports.
8. **Design Studio** — user journeys, sitemap, wireframes, responsive previews, design tokens, component inventory, accessibility states, and implementation handoff.
9. **Data & Experiment Lab** — dataset registry, provenance, schemas, transformations, validation, reproducibility, experiment runs, metrics, and privacy controls.
10. **Plugin & Tool Hub** — provider catalogue, adapter status, owner connection status, capability scopes, data classification, risk, approvals, health, and invocation audit. OAuth connected does not mean an adapter is executable.
11. **Knowledge Fabric** — project memory, reusable decisions, file and artifact indexing, source citations, semantic search, retention, and owner-controlled correction.
12. **Quality & Security Centre** — acceptance checks, unit/integration/e2e tests, accessibility, dependency/container scans, secret scans, SBOM, provenance, and exact-head verification.
13. **Delivery Centre** — reports, source bundles, release notes, handover packages, unresolved risks, sign-off, and export history.
14. **Studio Settings** — workspace defaults, model preferences, project templates, notification preferences, plugin connections, workforce preferences, privacy, and audit history.

## Shared component system

- StudioShell: mobile-first navigation, workspace switcher, command search, account context.
- MissionHeader: project identity, status, owner, risk, last update.
- ProjectCard: objective, progress evidence, next milestone, blockers.
- TaskGraphCanvas: dependency graph with list fallback for small screens and accessibility.
- TaskInspector: owner, inputs, outputs, dependencies, retries, approval, evidence.
- AgentCapabilityCard: capabilities, allowed actions, live availability, load, quality.
- ExecutionAdapterStatus: adapter identity, independent-runtime flag, worker health, honest limitation text.
- ArtifactBrowser: files, versions, provenance, preview, download.
- EvidenceTimeline: append-only event history and integrity status.
- ApprovalGate: exact action, actor, scope, impact, evidence, approve/reject.
- DiffReview: base SHA, proposed diff, file summary, checks, review status.
- ResearchSourceCard: publisher, URL, date, source type, claim links, confidence.
- PluginCapabilityCard: provider, adapter, owner connection, scopes, risk, human approval.
- QualityGateBoard: check status using passed/failed/queued/skipped/cancelled/missing/provider-blocked.
- MobileActionBar: context-aware actions with safe defaults and no desktop-terminal requirement.

## Studio-owned execution architecture

Studio should expose a stable execution contract, not a Jarvis-specific route:

- StudioProjectService: validates project briefs, creates project records, owns lifecycle transitions.
- StudioExecutionAdapter: server-selected adapter contract for submitting work.
- StudioScheduler: claims eligible tasks, resolves dependencies, schedules bounded concurrency, applies backoff, and recovers expired leases.
- StudioWorkerRuntime: executes only tasks with declared capabilities and bounded execution context.
- StudioTaskGraph: stores task dependencies, parent/child relationships, and completion requirements.
- StudioEventLedger: append-only progress, handoffs, approvals, outputs, and errors.
- StudioArtifactService: owner-scoped artifact storage and provenance.
- StudioPolicyBridge: asks Gen-X for authorization; never implements a second permission authority.
- StudioToolGateway: checks owner connection, adapter, capability, data classification, risk, and approval before plugin calls.

The current code introduces the execution-adapter seam and reports the current Jarvis-backed adapter as non-independent. The native scheduler, worker runtime, and durable task-graph persistence remain future implementation work and must not be implied as available.

## Independent execution milestones

### Milestone A — lifecycle foundation
- Studio-owned project and task contracts.
- Adapter interface and honest adapter telemetry.
- Project/task state model and acceptance criteria.
- Owner-scoped evidence and artifact interfaces.

### Milestone B — native scheduler
- Durable task graph and dependency resolver.
- Atomic claim/lease operations, heartbeat, retry policy, idempotency keys, dead-letter handling, cancellation, and recovery sweep.
- Queue isolation by project and task type.
- Worker availability and capacity reporting.

### Milestone C — specialist workforce
- Capability-based assignment and team composition.
- Bounded context and task-specific tool grants.
- Parallel work with dependency-aware joins.
- Quality scoring based on reproducible acceptance evidence, not self-reported success.

### Milestone D — plugin execution
- Server-side connection vault integration.
- Provider-specific adapters with typed input/output schemas.
- Gen-X policy decision before execution.
- Human approval for write, outbound, destructive, financial, repository, and production-impacting actions.
- Idempotency, timeout, retry, audit, and provider callback verification.

### Milestone E — end-to-end delivery
- Project → task graph → specialist work → artifact → quality gates → human review → delivery package.
- Resume after interruption and recover from worker/provider failure.
- Exact provenance from brief to final artifact.
- Mobile-first usability and accessible list alternatives to graph visualizations.

## Non-negotiable controls

- Gen-X remains the sole authorization authority.
- No model can approve its own permissions or escalate its scope.
- Project submission is not execution completion.
- Queue accepted is not worker running; worker running is not task completed.
- No production deploy, production migration, secrets change, paid upgrade, outbound communication, brokerage action, or auto-merge without the separate required approval.
- All repository writes must be isolated, diff-visible, exact-source-bound, checked, and human-reviewed.
- Plugin catalog entries and OAuth connections are not proof of executable adapters.
- Every status shown in Studio must be derived from persisted or provider-verifiable evidence.

## Definition of a complete Studio

A user can start a project from a phone, see the task plan and dependencies, assemble a capable team, connect approved tools, pause or steer work, inspect code/research/design/data artifacts, verify quality evidence, review risks, and export a finished deliverable. The same workflow remains operable if Jarvis is unavailable because Studio has its own scheduler and worker runtime, while Gen-X still controls authorization.