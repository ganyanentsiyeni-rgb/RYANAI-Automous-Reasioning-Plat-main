# RyanAI Mission Control and Governed Workforce

**Status:** Engineering increment — existing twelve-agent ownership registry plus deterministic mission-planning contracts.
**Base:** `ff0e33b8792c6d851d039c1e01b224a3e4fd8903`.
**Rollout:** No production deployment, production migration, secret change, paid upgrade or infrastructure mutation.

## Existing workforce identities

The repository already contains twelve accountable module-agent identities in `src/agent/moduleAgentRegistry.ts`:

1. Admin Steward — Admin Console.
2. Operations Operator — Operator Console.
3. Cockpit Observer — Command Cockpit.
4. Quant Researcher — Quant Lab.
5. Audiobook Producer — Audiobook Studio.
6. Communications Steward — Communications.
7. Repository Engineer — GitHub Engineering.
8. Inference Analyst — Inference Console.
9. Memory Curator — Memory Vault.
10. Voice Quality Analyst — Voice.
11. Studio Builder — RyanAI Studio.
12. Reliability Coordinator — Operations Center.

The existing ten-person `RYANAI_WORKER_ROSTER` in `src/agent/workerRegistry.ts` remains the shared technical-specialist pool. It is not overwritten or relabelled as the twelve module owners. The twelve entries are registered ownership identities, not proof of twelve live model processes or independent execution runtimes.

## Authority and accountability

- RyanAI remains the owner and final decision-maker.
- Gen-X is the authorization authority and fails closed.
- Jarvis plans, decomposes, schedules and coordinates missions. It cannot grant permissions.
- Each module agent is accountable for its module's diagnostics, proposals, evidence and outcomes.
- Shared specialists contribute bounded work under the mission's existing scope.
- A separate Mission Evaluator verifies acceptance criteria. It cannot authorize execution, grant permissions or verify its own proposal.

## Deterministic mission planning

`src/agent/missionControl.ts` adds pure planning primitives for:
- dependency graph validation and ready-task selection;
- swarm sizing from ready work, complexity, available execution slots, registered identities and remaining model-call budget;
- budget preflight across model calls, tokens, runtime and infrastructure-cost estimates;
- independent evaluation against acceptance criteria and evidence references.

The planner does not invoke models or perform side effects. It cannot itself guarantee budget enforcement or reserve spend.

## Runtime integration still required

Studio already has a separate Node worker entry point, Postgres-backed task claims/leases, heartbeat, lease recovery, a deterministic `studio.plan` handler and a Gen-X policy adapter. The built-in handler is a plan-artifact generator, not a model-powered coding or research worker.

Before autonomous multi-agent dispatch is enabled, the next runtime increment must:
1. bind each module-agent identity to authenticated worker identity and task scope;
2. connect Jarvis mission decomposition to the mission planner and existing Studio task queue;
3. route each task to one accountable module owner and optional shared specialist contributors;
4. isolate each execution in a disposable workspace/sandbox with deny-by-default network and no production access;
5. implement a durable atomic budget reservation/settlement ledger at the server-side provider gateway and worker execution boundary;
6. persist mission, assignment, handoff, approval, retry, evaluator and evidence events using the existing Studio event ledger or an approved durable store;
7. enforce cancellation, lease recovery, bounded retries, idempotency and per-worker concurrency;
8. add a separate evaluator execution path and evidence-backed completion gate;
9. expose truthful agent/mission states and budget telemetry in the Mission Control UI.

The current provider gateway authenticates delegated identity and checks Gen-X, but this increment does not yet bind provider calls to a mission budget ledger. The governance policy still records runtime profile enforcement as contract-only and project execution as not isolated. Those states must not be represented as complete.

## Safety and rollout gates

- No agent can grant or expand permissions, approve its own work, access secrets, merge, deploy, run production migrations, send live communications, place brokerage orders or modify policy.
- Gen-X is checked server-side immediately before each capability execution; unavailable or ambiguous policy denies.
- Human approval is bound to one action/task and cannot override a Gen-X DENY.
- Queued, skipped, cancelled, configured, provider-blocked or unverified work is never reported as passed.
- Independent evaluation requires a different evaluator identity and evidence references for every acceptance criterion.
- No production migration or deployment is part of this increment.

## Verification

The accompanying Vitest suite checks the twelve-agent registry, safe capability declarations, accountable task routing, dependency/cycle handling, dynamic concurrency bounds, budget preflight and independent evidence evaluation. These tests do not prove provider gateway enforcement, sandbox isolation, hosted worker availability or production readiness.
