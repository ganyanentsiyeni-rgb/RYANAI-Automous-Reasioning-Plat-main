# RyanAI Standalone Platform — Engineering Foundation

**Status:** Proposed implementation contract; phase 0 foundation  
**Target:** RyanAI platform only  
**Baseline:** `a7dbbf86618547b7c9eb2b10aa1cc724af4ce275`  
**Scope:** Platform kernel, autonomous workforce, self-engineering, self-healing, memory, security, evaluation, workspaces, and continuous improvement.

This document defines RyanAI as a standalone autonomous platform. Its capabilities are native RyanAI services. No external orchestration or policy product is a runtime prerequisite. Legacy components may remain during migration, but new platform capabilities must not require them, delegate their essential responsibilities to them, or silently fall back to them.

This is an engineering contract, not a claim that the target capabilities already exist. Each phase requires implementation, tests, exact-commit evidence, and a separate acceptance decision.

## 1. Product definition

RyanAI is a self-operating, self-maintaining, self-repairing, self-evaluating and continuously improving AI platform. It provides a shared foundation for its workspaces, agents, workers, models, integrations and infrastructure.

The platform must be able to:
- understand its own components, dependencies, health, capabilities and limitations;
- accept objectives and turn them into bounded, observable work;
- select and coordinate specialist agents and workers;
- execute work in isolated environments using narrowly scoped capabilities;
- detect, diagnose, repair and verify software and operational failures;
- retain durable, provenance-backed memory and evidence;
- evaluate the quality, safety, cost and reliability of its own outputs;
- recover safely from worker, provider, queue and service failures;
- continuously propose and validate improvements.

Autonomy does not mean unrestricted authority. Every operation is bounded by platform-enforced identity, capability, resource, environment, risk, budget and approval constraints.

## 2. Platform planes

### 2.1 Experience plane
Command Center, Operator Console, Admin Console, Cockpit, Studio, Quant Lab, Audiobook Studio, Comms, PhoneLink, Memory Vault, Inference Console and GitHub integration. Workspaces are clients of shared platform APIs, not independent implementations of orchestration, memory or authorization.

### 2.2 Platform kernel
The kernel owns:
- human, agent, worker and service identities;
- capability definitions, grants, expiry and revocation;
- task and mission state machines;
- scheduling, dependency resolution and concurrency;
- resource and budget accounting;
- event publication and subscription;
- policy evaluation and approval records;
- audit and evidence references;
- service and capability discovery.

Kernel services must be available through versioned internal contracts. A failed optional subsystem must not corrupt the kernel's authoritative state.

### 2.3 Intelligence plane
Model registry, provider adapters, routing, context assembly, agent profiles, planning, structured outputs, retrieval, model evaluation and fallback selection. Model availability and model quality are separate signals. Routing decisions must be explainable and measurable.

### 2.4 Workforce plane
Primary module agents and specialist workers are registered identities, not proof of running processes. The runtime must supply durable dispatch, leases, heartbeats, cancellation, retries, idempotency, concurrency limits, isolation and recovery.

### 2.5 Execution plane
All external and internal actions pass through a server-side capability gateway. The gateway validates the authenticated principal, task, capability, resource, action, environment, input digest, budget, expiry and approval requirements immediately before execution. UI checks and agent prompts are not security controls.

### 2.6 Evidence and observability plane
Every consequential operation emits structured events, trace context, audit records and an execution receipt. A successful API response, configured integration, queued job or agent assertion is not proof of a completed outcome.

### 2.7 Persistence plane
PostgreSQL is authoritative for durable platform state. Redis/Valkey may accelerate queues, locks and caches but is not the sole record of missions, approvals, audit or evidence. pgvector stores derived embeddings linked to governed source records. Object storage holds large artifacts with integrity hashes, ownership and retention metadata.

## 3. Native platform services

| Service | Required responsibility |
|---|---|
| Identity service | Authenticate principals and maintain stable service/agent identities |
| Capability registry | Define operations, schemas, scopes and risk classes |
| Policy and approval service | Enforce least privilege, approval, expiry and revocation |
| Mission service | Persist objectives, acceptance criteria, constraints and lifecycle |
| Task scheduler | Resolve dependencies, dispatch eligible work and enforce concurrency |
| Worker runtime | Leases, heartbeats, retries, cancellation, idempotency and recovery |
| Workspace manager | Create disposable, isolated task environments and collect artifacts |
| Tool gateway | Validate and execute scoped capabilities |
| Model gateway | Route inference, enforce quotas, record provider usage and failover |
| Budget ledger | Atomically reserve and settle tokens, calls, time and infrastructure cost |
| Event service | Durable event publication, delivery tracking and replay protection |
| Memory service | Store and retrieve scoped, provenance-backed memory |
| Evidence service | Bind claims, results and findings to exact artifacts and commit identities |
| Evaluation service | Independently assess acceptance criteria, regression and quality |
| Health service | Aggregate fresh, stale, missing, degraded and failed component signals |
| Recovery service | Execute bounded restart, reschedule, isolate and restore procedures |
| Engineering service | Diagnose repository defects, prepare isolated patches and open review proposals |
| Learning service | Evaluate proposed improvements and retain only verified outcomes |

Each service must have a documented owner, API contract, persistence ownership, health contract, security boundary, failure mode and test suite.

## 4. Autonomous self-engineering lifecycle

1. Detect a defect from repository checks, runtime telemetry, security findings or an explicit report.
2. Create an incident/repair record with source, timestamp, severity and affected component.
3. Reproduce the defect in a disposable environment.
4. Trace the root cause and identify the smallest safe repair.
5. Create an isolated branch/workspace from a recorded base commit.
6. Apply a focused patch with a bounded file and capability scope.
7. Run targeted tests, full relevant regression tests, static analysis and security checks.
8. Run an independent evaluation against explicit acceptance criteria.
9. Attach exact-commit evidence, changed-file inventory, test results and unresolved risks.
10. Open a draft pull request for human review.
11. After a separately approved merge, observe the resulting commit and verify the post-merge outcome.
12. Record the verified repair and regression-prevention measure in engineering memory.

The engineering service may create branches and pull requests when explicitly enabled. It must not bypass review, merge protected changes automatically, deploy production, migrate production databases, alter secrets or perform live external communications without their separate approvals.

## 5. Self-healing lifecycle

Health signals must include source, observed time, freshness, environment and confidence. The platform distinguishes healthy, degraded, failed, stale, missing, queued, skipped, cancelled and provider-blocked states.

Permitted bounded recovery examples include retrying an idempotent task, restarting an isolated worker, rescheduling expired leases, switching to an approved model fallback and quarantining a faulty worker. Recovery must be rate-limited, audited and followed by independent health verification.

Database repair, destructive data operations, credential changes, production deployment and infrastructure resizing are not automatic recovery actions.

## 6. Mission and task contracts

Every mission contains:
- stable mission ID and owner;
- objective and measurable acceptance criteria;
- risk classification and environment;
- permitted capabilities and resource scopes;
- budget and deadline;
- dependency graph;
- cancellation and escalation rules;
- evidence requirements.

Mission, task, authorization, execution and verification states are separate dimensions. Retries create new attempts; history is never overwritten. Completion requires all mandatory criteria to have verified evidence tied to the relevant attempt and artifact.

## 7. Agent and worker execution contract

Every agent/worker identity has a versioned profile:
- identity and owning domain;
- supported task types;
- input/output schema;
- permitted capabilities;
- resource and concurrency limits;
- model constraints;
- timeout and retry policy;
- evaluation criteria;
- health and performance metrics.

A registry entry is not a running worker. Dispatch requires a durable runtime, an available lease, an eligible identity, valid capability grants, remaining budget and an isolated execution slot. Workers cannot grant themselves capabilities or change their own limits.

## 8. Memory and learning contract

Memory records include source, owner/scope, creation and observation times, confidence, classification, retention, version and verification status. Unverified conclusions remain hypotheses. Contradictions are retained and surfaced rather than silently overwritten.

Learning uses offline evaluation sets and regression suites. A proposed change is retained only when its improvement is demonstrated without unacceptable regressions in safety, quality, latency, cost or reliability. Production behavior is not self-modified from an unverified online observation.

## 9. Security and resilience requirements

- Least-privilege service and worker identities.
- Default-deny network access for disposable workspaces.
- Secrets available only through scoped runtime injection; never in prompts, logs or artifacts.
- Input validation, output validation, schema versioning and replay protection.
- Per-task resource limits and atomic budget reservations.
- Tamper-evident audit and artifact integrity hashes.
- Tenant and owner isolation for data and memory.
- Backup, restore and disaster-recovery exercises.
- Kill switch and cancellation propagation.
- Fail-closed behavior when identity, policy, evidence or budget state is unavailable.

## 10. Delivery architecture

The current repository's Render and Railway boundaries remain the deployment baseline unless a separately reviewed architecture decision changes them. Supabase Auth remains the identity provider; application-owned PostgreSQL, Redis/Valkey, pgvector and separately scoped audiobook persistence retain their documented ownership boundaries.

No architecture document authorizes production deployment, production migration, secret changes, infrastructure changes or paid upgrades.

## 11. Phased implementation and acceptance gates

| Phase | Implementation | Acceptance gate |
|---|---|---|
| 0. Baseline | Repository/service inventory, ownership map, threat model, architecture decisions | Every existing capability classified as implemented, partial, missing, failed or unverified |
| 1. Kernel | Identity, capability registry, policy/approval, mission/task state, event and audit contracts | Contract tests, negative authorization tests, persistence and replay tests |
| 2. Durable runtime | Queue, leases, heartbeat, retries, cancellation, idempotency and worker recovery | Crash/restart, duplicate-delivery and lease-expiry tests |
| 3. Execution fabric | Tool gateway, isolated workspaces, resource controls and atomic budget ledger | Deny-by-default, escape, quota-race and audit tests |
| 4. Intelligence/workforce | Model gateway, agent profiles, dynamic scheduling and independent evaluation | Provider outage, routing, assignment and evaluation benchmarks |
| 5. Self-engineering | Defect intake, reproduction, patch workspace, CI evidence and draft PR workflow | Reproducible repair exercises with exact-head evidence |
| 6. Self-healing | Health aggregation, bounded recovery and post-recovery verification | Injected-failure and recovery drills |
| 7. Memory/learning | Provenance-backed memory, retrieval, contradiction handling and offline improvement evaluation | Isolation, retention, retrieval-quality and regression tests |
| 8. Workspace integration | Shared platform APIs across all workspaces | End-to-end contract and authorization tests per workspace |
| 9. Resilience | Backup/restore, disaster recovery, capacity and cost controls | Measured recovery objectives and load tests |
| 10. Operational maturity | SLOs, runbooks, dashboards, incident reviews and continuous improvement | Evidence-backed service-level targets sustained over an agreed observation window |

Phases may have parallel implementation branches only where dependencies permit. Each phase is independently reviewable; no phase is considered complete because its documentation or scaffolding exists.

## 12. Required engineering evidence

Every implementation PR must state:
- exact base and head commit SHA;
- files and contracts changed;
- tests added and executed;
- CI/security workflow run IDs and terminal conclusions;
- passed, failed, queued, skipped, cancelled, missing and provider-blocked checks separately;
- migration impact (including explicit "none" when applicable);
- deployment/secret/infrastructure impact;
- risks, rollback/recovery plan and human review requirement.

A queued, skipped, missing or provider-blocked check is never a pass. A configured service is not a live service. A registered agent is not a running worker. A proposed design is not an implementation.

## 13. Immediate next engineering actions

1. Inventory the exact current main tree, workflows, package scripts, API routes, Prisma schemas/migrations, agent/worker runtime and workspace integrations.
2. Reconcile open pull requests and current CI state before overlapping changes.
3. Build a dependency graph and gap matrix against the services and acceptance gates above.
4. Select the smallest foundational code increment with executable tests.
5. Implement on a separate branch, open a draft PR, and inspect exact-head CI/security evidence.
6. Continue phase by phase without auto-merge or production actions.
