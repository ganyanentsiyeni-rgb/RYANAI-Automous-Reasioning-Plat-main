# RyanAI Mission Control and Governed Workforce

**Status:** First Mission Control engineering increment: twelve module-agent ownership identities plus deterministic planning contracts.
**Base:** mainline at PR creation.
**Rollout:** No production deployment, production migration, secret change, paid upgrade or infrastructure mutation.

## Existing workforce

The canonical twelve accountable module-agent identities already exist in `src/agent/moduleAgentRegistry.ts`:

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

The ten-worker `RYANAI_WORKER_ROSTER` remains the shared technical-specialist pool. Module ownership identities and executable worker processes are distinct concepts.

## Authority

RyanAI remains the owner and final decision-maker. Gen-X authorizes. Jarvis coordinates. Module agents own module diagnostics, proposals and evidence. Shared specialists contribute under bounded scope. The Mission Evaluator is separate from the proposer and cannot authorize execution.

## Mission planning added here

`src/agent/missionControl.ts` provides deterministic primitives for dependency validation, ready-task selection, dynamic swarm sizing, task-to-module-owner assignment, budget preflight across model calls/tokens/runtime/estimated infrastructure cost, and evidence-backed independent evaluation.

These are side-effect-free planning functions, not a durable spend ledger or proof of running workers. The server-side provider gateway must enforce budgets through atomic reservations and settlement before autonomous provider calls are enabled.

## Runtime gaps that remain

Studio already has a separate Node worker process, Postgres task leases, heartbeat and recovery, and Gen-X authorization. Its current `studio.plan` handler creates a deterministic plan artifact; it is not a model-powered coding/research worker.

Before claiming a live autonomous workforce, implement:
1. authenticated module-agent identity binding and Gen-X capability checks;
2. Jarvis mission decomposition connected to the durable Studio task queue;
3. per-task isolated workspaces/sandboxes with production and unrestricted network denied;
4. durable atomic budget reservation/settlement at the provider gateway and worker boundary;
5. append-only mission/assignment/handoff/approval/retry/evaluation/evidence history;
6. bounded retries, idempotency, cancellation, leases and per-worker concurrency;
7. an independent evaluator execution path;
8. Mission Control UI for mission state, worker heartbeat, evidence, blockers and budget usage.

Current governance documentation still identifies profile binding as contract-only and project checks as not sandbox-isolated. Those states must not be represented as complete.

## Safety

No agent may grant permissions, approve its own work, access secrets, merge, deploy, migrate production, dispatch live communications, place brokerage orders or modify policy. Gen-X denial is final. Queued, skipped, cancelled, provider-blocked or unverified work is not success. No production migration or deployment is included.

## Validation

The accompanying Vitest suite covers the twelve identities, safe action declarations, Studio task ownership mapping, dependency handling, concurrency sizing, budget preflight and independent evidence verification. It does not prove provider-gateway budget enforcement, sandbox isolation or hosted worker availability.
