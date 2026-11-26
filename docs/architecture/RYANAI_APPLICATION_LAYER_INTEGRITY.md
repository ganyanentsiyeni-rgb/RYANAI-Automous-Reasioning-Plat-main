# RyanAI application layers — integrity contract and implementation baseline

**Status:** implemented static architecture inventory and dependency-topology audit. This document is an architecture contract and evidence guide, not a claim that every boundary is already enforced or every process is live.

## 1. Purpose

RyanAI is one application with independently accountable layers. Each layer has a bounded responsibility, an explicit interface to adjacent layers, and evidence appropriate to its claims. The goal is to prevent UI, agents, models, integrations, and persistence from becoming a collection of mutually trusted modules.

Operating principle:

**AI proposes → Gen-X authorizes → Jarvis coordinates → tools execute → evidence proves → Memory Vault remembers.**

The user-facing experience must never be treated as an authorization boundary. Registration, configuration, type declarations, or a successful build must never be treated as proof of runtime availability.

## 2. Canonical logical layers

The following eight-layer model is the canonical logical view. The audit tool maps existing repository paths into these layers; it does not move files or infer that similarly named directories are duplicate implementations.

| Layer | Responsibility | Current source roots inventoried |
|---|---|---|
| L1 Experience | Web, admin, mobile and operator surfaces | `src/pages`, `src/components`, `src/screens`, `apps/mobile`, `android` |
| L2 Application/API | Route handlers, API clients, application services and hooks | `src/routes`, `src/api`, `src/services`, `src/hooks` |
| L3 Identity/security/governance | Gen-X policy, approval and request middleware | `src/security`, `src/approvals`, `src/middleware` |
| L4 Orchestration/workforce | PA/specialist registration, delegation, scheduling and workers | `src/agents`, `src/orchestrator`, `src/workers`, `src/scheduler` |
| L5 Reasoning/intelligence | Agent reasoning, graph/engine, inference and model catalogue | `src/agent`, `src/engine`, `src/inference`, `models`, `quant-engine` |
| L6 Tools/integrations | Tool adapters, MCP, plugins and Comms/external integration surfaces | `src/tools`, `src/mcp`, `src/plugins`, `src/integrations`, `mcp-server`, `comms-orchestration` |
| L7 Data/persistence | Database adapters, stores, Prisma and Supabase schema/migrations | `src/database`, `src/db`, `src/store`, `prisma`, `supabase` |
| L8 Runtime/platform | Server bootstrap, config, telemetry, infrastructure, operations and workflows | `src/server`, `src/config`, `src/observability`, `src/telemetry`, `observability`, `infra`, `ops`, `.github/workflows` |

The path map is an inventory convention, not a package boundary. A file can call another layer through an explicit interface; the presence of an import edge is not itself a defect. The audit also reports source files outside these roots as unclassified instead of silently assigning them.

## 3. Dependency and authority rules

These are the intended dependency rules for review and incremental enforcement:

1. **Experience → Application/API.** UI components call authenticated application interfaces. They do not connect directly to databases, provider credentials, privileged tools, or worker queues.
2. **Application/API → Governance.** Every protected operation obtains server-side identity, owner/tenant scope, capability authorization and approval state. A UI flag or client-supplied role is never authority.
3. **Application/API → Orchestration.** Application services create durable requests/delegations and return persisted identifiers and server-confirmed states. They do not claim execution from request acceptance.
4. **Orchestration → Reasoning and capability interfaces.** PA/Jarvis choose plans and specialists; workers execute only registered task types under persisted owner scope, lease, capability and approval constraints.
5. **Reasoning → governed model gateway.** Model selection and invocation use the server-owned provider registry/adapter. Model output is untrusted input, not permission to execute tools.
6. **Tools/integrations → authorized execution boundary.** MCP, plugins, Comms and external adapters require explicit capability checks, bounded inputs, idempotency where side effects exist, and attributable receipts.
7. **Application/orchestration → persistence contracts.** Data access is server-side and schema-backed. Migrations are explicit operations, never an incidental API startup side effect.
8. **Runtime/platform hosts the layers.** Health, telemetry, configuration and deployment evidence must distinguish process liveness, dependency readiness, handler registration, live worker heartbeat, provider configuration and provider health.
9. **Evidence flows back up.** Each state transition is recorded with stable identifiers and provenance. A dispatch receipt, queued job, registered handler, model response, or UI success toast is not proof of downstream completion.
10. **No layer bypasses Gen-X.** Admin, PA, Jarvis, workers, automation, MCP and tools use the same server-side policy authority appropriate to the capability. No frontend or model-generated instruction can elevate privileges.

These rules are architecture acceptance criteria. The initial static audit inventories relative imports and cross-layer edges; it intentionally does not fail builds on a guessed allowlist while the existing topology is being measured.

## 4. Canonical request lifecycle

For a PA objective, the expected trace is:

1. Experience authenticates the session and submits an objective with a request/idempotency identity.
2. Application/API validates payload, session, tenant/owner scope and API contract.
3. Governance evaluates the actor, capability, risk, approval and policy context.
4. Application persists a durable AgentRun/delegation before acknowledging accepted work.
5. Orchestration schedules a registered specialist and establishes a lease.
6. Reasoning selects an approved model path; any tool invocation returns through a capability-authorized integration boundary.
7. The worker revalidates its lease and authorization immediately before side effects.
8. Data/persistence records state transitions, outputs and append-only evidence.
9. Application exposes the persisted result; Experience renders only server-confirmed state.
10. Internal Comms can report the task result, but a Comms task or provider dispatch is not proof of external delivery. Delivery requires provider receipts.

The same trace applies to Admin and Darkside Copilot surfaces. They are operator surfaces, not alternative authorization systems. Gen-X authorizes; Jarvis coordinates; neither a model nor a coordinator receives implicit execution authority.

## 5. Implemented audit tooling

The repository now includes:

- `scripts/audit-application-layers.mjs` — bounded, read-only source inventory and relative-import topology report.
- `scripts/audit-application-layers.test.mjs` — fixture tests for layer discovery, cross-layer edges, unresolved relative imports, ignored dependency folders, root confinement and cancellation.
- `npm run audit:application-layers` — emits a JSON report.
- `npm run test:application-layers` — executes the focused Node test suite.
- `npm run validate` — includes the focused application-layer tests.

The tool reports per-layer source counts, present/missing roots, cross-layer relative-import edges, unresolved relative imports and unclassified files. It is bounded by source-file count, file size and traversal depth; ignores dependency/build/cache/VCS directories; skips symlinks; and confines declared roots to the repository.

The tool does not execute discovered code, read environment values, make network calls, inspect secrets, connect to services, run migrations, or infer runtime health. Its output explicitly records those limitations.

### Report interpretation

- `STATIC_BASELINE_READY_FOR_REVIEW` means all declared layer roots were found. It does **not** mean the architecture is clean or runtime-ready.
- `REVIEW_REQUIRED` means one or more declared roots are absent.
- A cross-layer edge is an observation, not an automatic violation.
- An unresolved relative import may reflect an alias, generated file, platform resolver or a real broken import; it requires review.
- Unclassified source files are visible follow-up work, not silently hidden.
- Runtime execution remains unverified by this static tool.

## 6. Required validation and evidence

For every layer, acceptance requires evidence at the appropriate level:

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Static inventory | Files and declared roots exist | Code executes |
| Import topology | Resolvable relative dependency edges | All aliases/runtime dependencies |
| Typecheck/lint | Selected static contracts hold | Correct runtime behavior |
| Unit tests | Isolated logic contracts | Integrated service behavior |
| API/contract tests | Request/response and authorization contracts | Production provider health |
| Integration tests | Connected components behave in the test environment | Production data compatibility |
| Worker heartbeat + lease evidence | A specific worker process is live and able to claim work | All worker profiles are live |
| Runtime health checks | A particular process/dependency check passed at a timestamp | Overall system correctness |
| Provider receipt + health verification | A specific provider deployment and endpoint were verified | Other provider outcomes |

A clean result must be tied to the exact commit SHA and test environment. Missing, skipped, queued, stale, cancelled or provider-blocked evidence is not a pass.

## 7. Work remaining after the baseline

The static topology report is the first implementation increment. It creates a repeatable evidence baseline without speculative refactoring. The next changes should be driven by observed report edges and traced execution paths:

1. Resolve unclassified source roots and document their ownership.
2. Review the highest-volume cross-layer dependencies and identify direct UI-to-infrastructure or reasoning-to-side-effect paths.
3. Consolidate duplicated service/agent entrypoints only where call graphs and runtime ownership prove duplication.
4. Add typed ports/adapters at confirmed boundary violations, preserving existing authorization and idempotency semantics.
5. Add end-to-end trace tests for User/Admin login → API → Gen-X → AgentRun → Jarvis/worker → tool/model → evidence → UI/Comms.
6. Add runtime evidence for every claimed worker, model provider, integration and health state.
7. Enforce only those dependency rules that are verified against the current graph; do not add blanket lint rules that break valid adapters.

No application module is deleted or moved by this baseline. No role, capability, policy, credential, database schema, migration, provider setting, production resource or deployment is changed.

## 8. Operational commands

```bash
npm run audit:application-layers
npm run test:application-layers
```

Run the audit from the repository root. Preserve its JSON output with the exact commit SHA when using it as architecture evidence. Do not interpret a static baseline as a production readiness certificate.
