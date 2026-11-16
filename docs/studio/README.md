# RyanAI Studio

RyanAI Studio is the engineering and research workspace for planning, coordinating, implementing, and verifying software and research projects. It is a client for the existing RyanAI architecture; it must not create a parallel agent runtime or bypass platform authorization controls.

## Studio independence roadmap

Studio is the owner of the project lifecycle, even while the first execution adapter remains Jarvis-backed. The server-side boundary lives in `src/server/engineering/studioExecution.ts`:

- Studio routes submit typed project requests to a server-selected `StudioExecutionAdapter`.
- The active adapter reports its identity and whether its runtime is genuinely independent.
- The current `jarvis-agent-runs` adapter delegates to the existing durable queue and reports `independentRuntime: false`.
- Adapter selection is not exposed to browser input. A client cannot select a worker, change execution authority, or grant permissions.
- A future Studio-native adapter must implement durable scheduling, task dependency handling, leases/retries, cancellation, worker heartbeats, recovery polling, and persisted evidence before it can report independent execution.
- Gen-X remains the authorization authority regardless of which execution adapter is active.

This is an architectural seam, not a claim that independent execution already exists. The UI and API must keep the current adapter limitation visible until a native scheduler and worker have been implemented, reviewed, and tested.

## Architecture contract

- **Studio UI**: project briefs, coding workbench, persisted project runs, coding queue, workforce roster, plugin readiness, handoffs, results, and evidence.
- **Execution adapter**: Studio owns project intake and lifecycle semantics. The current `jarvis-agent-runs` adapter submits through the durable `agent_runs` queue; this is a compatibility adapter, not independent Studio execution.
- **Workforce**: `RYANAI_MODULE_AGENT_ROSTER` and `RYANAI_WORKER_ROSTER` are the canonical capability/ownership registries. Roster membership is not proof of live availability. Runtime status comes from `getAgentTaskWorkerStatus()`.
- **Gen-X**: authorization authority. Studio must not grant agents new permissions or infer approval from a task request. This remains true for every present or future execution adapter.
- **Plugin registry**: `pluginCatalog.ts` and `pluginRegistry.ts` define manifests, capability risk, approval requirements, data classifications, and adapter registration status. A catalogue entry is not an executable integration.
- **Persistence**: owner-scoped `AgentRun`, `AgentHandoff`, and `CodingTask` records are authoritative for project history and execution outcomes.

## Project lifecycle

1. An authenticated owner submits a typed brief with objective, expected deliverables, acceptance criteria, and constraints.
2. The Studio API validates the payload and rejects detected credential material.
3. The API persists the brief through `dispatchAutonomousTask` and returns HTTP 202 with the durable task ID.
4. The existing queue worker claims and processes the task under its existing runtime and authorization boundaries.
5. Studio refreshes persisted owner-scoped project/task state while work is active.
6. Handoffs, errors, and persisted results are displayed as evidence. A queued/running state is never presented as completion.
7. A reasoning/project run is not itself a code-writing job. To modify a repository, the owner must use the coding workbench to create a proposal bound to an exact base commit and diff, review the plan, and pass the existing approval gate before the coding worker is queued.
8. Coding changes remain subject to exact-head CI/security checks and human review. No auto-merge or deployment is initiated by Studio.

## Plugin compatibility contract

A provider is usable only when all of the following are true:

- its manifest is registered in the canonical plugin catalogue;
- the server has a compatible adapter registered for the provider and capability;
- the signed-in owner has an active, non-revoked connection;
- the requested capability is declared by both manifest and adapter;
- risk policy and required human approval are satisfied;
- credentials are resolved server-side from the connection vault, never supplied by the browser or model.

OAuth connection support is not the same as adapter support. The current provider authorization routes cover Google Calendar and Microsoft 365 Calendar, but the catalogue describes many more providers. Providers without an adapter must remain visibly unavailable for execution. Outbound communication, destructive actions, repository writes, and other high-impact capabilities must preserve their separate human-approval requirements.

## Inference performance evidence

Studio's inference performance profile is specified in [INFERENCE_PERFORMANCE_EVIDENCE.md](./INFERENCE_PERFORMANCE_EVIDENCE.md). It defines a read-only evidence view for runtime inventory, single-agent performance, concurrent-agent throughput, and comparable benchmark runs. External AA-AgentPerf figures are labelled as external references, not RyanAI measurements. Accelerator-specific vLLM, FlashInfer, CUDA Graph, speculative-decoding, and Dynamo tuning remains owned by the serving operator; Studio does not provision hardware or alter runtime configuration. Benchmark execution remains gated by the existing RIIP offline harness approval, isolation proof, and separate human authorization.

## Workforce and model boundaries

- Specialist/module agents and shared workers are registered by capability and responsibility.
- Runtime health, queue-listener connectivity, task assignment, and actual task completion are separate facts and must be shown separately.
- Jarvis coordinates work; Gen-X retains authorization authority.
- Model routing or a roster entry must never grant a model permission to authorize itself.
- Research and coding outputs require source/provenance, reproducible checks, acceptance-criteria evidence, and explicit unresolved blockers.
- A task brief cannot authorize production deployment, production database migration, secret changes, paid upgrades, or outbound communications.

## Definition of done

- Authenticated owner isolation for every project, task, connection, and result.
- Project intake is durable and recoverable by the existing queue worker.
- UI reports queued, running, completed, failed, cancelled, and blocked states distinctly.
- Handoffs and results are sourced from persisted records.
- Plugin connection and adapter readiness are independently represented.
- Specialist capabilities are discoverable without implying live availability.
- Coding work has a clear proposal, exact base/head SHA, CI/security evidence, review, and merge gate.
- Mobile layouts remain usable without a desktop terminal; remote coding execution is provided only by the approved worker runtime.
- No automatic production side effects, bypasses, auto-merge, or unverified claims of completion.

## Current scope and known gaps

The first Studio completion increment added structured project intake, owner-scoped overview APIs, live worker/listener reporting, project/coding-task status and results, persisted handoffs, workforce visibility, truthful plugin readiness, and project/queue/provider filters. It does not make every catalogue provider executable. Provider adapters and capability-specific execution workflows must be implemented and reviewed separately before those integrations can be advertised as ready.
