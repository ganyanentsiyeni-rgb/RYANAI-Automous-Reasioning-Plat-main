# RyanAI Mission-Centric Operating Architecture

**Status:** Proposed target architecture  
**Scope:** Architecture and implementation guidance only  
**Audience:** Platform, application, data, security, and operations engineering  
**Decision principle:** AI proposes. Gen-X authorizes. Jarvis coordinates. Capability adapters execute. Evidence proves. Memory preserves. Humans retain approval authority.

> This document is a target-state design, not an implementation or readiness claim. It does not assert that every proposed API, service, table, integration, control, or workflow currently exists.

## 1. Executive architecture

RyanAI evolves from a collection of AI-enabled workspaces into a mission-centric operating system for governed intelligence and action. The design borrows useful ideas from ontology-driven operational platforms and enterprise AI orchestration, but deliberately inverts their centre of gravity:

**Mission → Authority → Reality → Reasoning → Coordination → Authorized execution → Verification → Institutional memory.**

The platform is organized into twelve domains and four independently governed planes.

### Twelve domains

1. **Mission and experience:** Command Center, Operator Console, Admin Console, Cockpit, Studio, and workspace interfaces.
2. **Identity and governance:** authenticated principals, Gen-X policy decisions, approvals, scopes, revocation, and audit.
3. **Ontology and context:** typed operational objects, relationships, lifecycle, semantic context, and lineage.
4. **Intelligence fabric:** model registry, provider adapters, routing, context assembly, structured outputs, and evaluation.
5. **Agent orchestration:** Jarvis planning, task dependencies, delegation, scheduling, retries, cancellation, and recovery.
6. **Execution fabric:** capability registry, adapters, APIs, workers, integrations, idempotency, and execution receipts.
7. **Memory and knowledge:** episodic, semantic, procedural, and operational memory with provenance and retention.
8. **Data foundation:** PostgreSQL, Supabase Auth, pgvector, Prisma, Redis, and scoped object storage.
9. **Evidence and observability:** audit, traces, tests, CI/security evidence, health, verification, and outcomes.
10. **Application workspaces:** Studio, Quant Lab, Audiobook Studio, Comms, PhoneLink, and administrative/operational surfaces.
11. **Infrastructure and delivery:** Render and Railway runtime boundaries, CI commit-based delivery, and operational management.
12. **Learning and optimization:** evaluations, benchmarks, feedback, reliability, cost, and measured improvement.

### Four planes

| Plane | Responsibility | Primary components |
|---|---|---|
| Control | Who may do what, to which resource, under what conditions? | Identity, Gen-X, policy, approval, capability grants |
| Intelligence | What should happen, and how should work be coordinated? | Ontology, context, models, agents, Jarvis, memory retrieval |
| Execution | What performs the authorized operation? | API services, workers, tools, adapters, workspaces |
| Evidence | What happened, and what proves it? | Audit, event records, traces, CI, verification, provenance |

Plane boundaries are security boundaries, not merely deployment diagrams. An intelligence-plane plan is not authorization. An approval is not execution. An execution response is not proof of a verified outcome.

## 2. Non-negotiable architectural principles

1. **Mission-first:** every workflow has an owner, objective, constraints, measurable acceptance criteria, and deadline/priority where relevant.
2. **Authority-first:** no model, agent, worker, tool, or workflow can grant itself authority or widen its scope.
3. **Ontology-first:** meaningful operational objects have stable identity, type, owner/scope, lifecycle, source-of-truth reference, and provenance.
4. **Execution-first:** recommendations become actions only through a server-side capability adapter after current authorization.
5. **Evidence-first:** consequential actions produce independently inspectable evidence; intent and configuration are not evidence of completion.
6. **Memory-first, but truth-constrained:** only provenance-backed, policy-eligible facts and verified outcomes become durable institutional knowledge.
7. **Fail-closed:** unavailable policy, invalid identity, expired approval, unknown capability, or unverifiable environment denies consequential execution.
8. **Least privilege:** permissions are scoped by principal, task, capability, resource, environment, risk, and time.
9. **Separation of duties:** the proposer, authorizer, executor, and verifier are distinct logical responsibilities; privileged workflows require human approval as policy dictates.
10. **No silent ownership transfer:** semantic references do not transfer schema, credential, retention, or operational ownership.

## 3. Authority model: Gen-X and Jarvis

### Gen-X — policy decision authority

Gen-X is the central authorization authority. Each adapter must enforce the decision independently on the server side immediately before execution. A user-interface visibility rule is never an authorization control.

Conceptual contract:

```typescript
type Environment = "development" | "staging" | "production";
type Decision = "allow" | "deny" | "require_approval";

interface AuthorizationRequest {
  requestId: string;
  principalId: string;
  principalType: "human" | "agent" | "service";
  missionId: string;
  taskId: string;
  capability: string;
  resource: string;
  action: string;
  environment: Environment;
  riskLevel: "low" | "medium" | "high" | "critical";
  requestedAt: string;
  idempotencyKey: string;
}

interface AuthorizationDecision {
  decision: Decision;
  decisionId: string;
  policyVersion: string;
  reasonCode: string;
  reason: string;
  approvalId?: string;
  constraints?: Record<string, unknown>;
  expiresAt?: string;
}
```

The implementation must bind a decision to the exact principal, mission/task, capability, resource, action, environment, and relevant input digest. An approval for one action cannot be replayed for a different action or payload. Decisions expire; revocation and policy-version changes must be checked before execution.

Required controls:
- authenticated human, agent, and service identities;
- scoped capabilities and resource ownership;
- environment- and risk-aware policy evaluation;
- explicit approval requests, grants, rejections, expiry, and revocation;
- policy versioning and decision explanations;
- immutable or tamper-evident audit evidence;
- replay protection and idempotency;
- fail-closed behavior when policy cannot be evaluated.

### Jarvis — bounded coordination

Jarvis decomposes missions, schedules tasks, selects eligible agents, tracks dependencies, handles handoffs, and aggregates results. Jarvis does not own policy, credentials, unrestricted infrastructure access, or production authority. It can request authorization; it cannot manufacture an allow decision.

## 4. Mission and task lifecycle

Mission state, task execution state, authorization state, and verification state are separate dimensions. Do not collapse them into one overloaded status field.

Suggested mission lifecycle:

```text
draft → submitted → validated → active
                         |          |
                         v          v
                    rejected     completed
                                  / failed
                                  / blocked
                                  / cancelled
```

Suggested task lifecycle:

```text
created → ready → authorization_pending → queued → running
                         |                  |         |
                         v                  v         v
                     rejected            cancelled  waiting_for_approval
                                                      |
                                                      v
                                                  running
                                                      |
                                      succeeded / failed / blocked / cancelled
```

Verification is independent: `not_started`, `pending`, `verified`, `rejected`, or `unverified`. A task can execute successfully but fail acceptance criteria. A mission is complete only when its required tasks and acceptance criteria have terminal, evidenced outcomes.

Every retry is a new attempt linked to the same task. Preserve prior attempts, inputs, authorization decisions, logs, and results; never overwrite history to make a retry look like the first execution.

## 5. Ontology: semantic layer, not a new system of record

The ontology describes RyanAI's operational world. It is a typed semantic layer over domain-owned records, not a replacement for PostgreSQL, Prisma, Supabase, or service-specific persistence.

### Foundational object types

| Type | Core meaning | Typical relationships |
|---|---|---|
| Person | Human principal | member_of, owns, approves |
| Organization / Tenant | Ownership and isolation boundary | contains, governs |
| Agent | Registered non-human worker identity | assigned_to, executes |
| Model | Inference implementation | served_by, evaluated_by |
| Mission | Desired outcome and constraints | contains_task, owned_by |
| Task | Bounded work unit | depends_on, assigned_to |
| Capability | Typed permitted operation | governed_by, invoked_as |
| Policy | Authorization rule/version | governs, evaluated_for |
| Approval | Human authorization for a bounded action | approves, expires_at |
| Resource | Governed target of an operation | owned_by, referenced_by |
| Event | Immutable occurrence record | caused_by, relates_to |
| Artifact | File, code, document, or output | produced_by, version_of |
| Evidence | Proof supporting a claim or decision | verifies, derived_from |
| Memory | Retained knowledge with provenance | sourced_from, relates_to |
| Workflow | Versioned process definition | contains_step, triggered_by |
| Environment | Development, staging, production | hosts, constrains |

Relationships are typed, directional where appropriate, versioned, and scoped. Each object reference includes an authoritative system and stable source identifier. Ontology projections must be rebuildable from authoritative records/events; losing a projection must not destroy domain truth.

A relationship record should minimally identify: relationship type, source object, target object, owner/scope, valid-time interval where relevant, recorded time, provenance, and schema version.

### Object identity and provenance

A semantic object reference should use a stable opaque identifier and explicit type, for example `ryanai://mission/{id}`. Do not embed secrets, personal data, or mutable display names in identifiers. Store source-system references separately from ontology IDs.

Every projection should carry:
- `objectType`, `objectId`, `schemaVersion`;
- `ownerScope` / tenant scope;
- `sourceSystem`, `sourceRecordId`;
- `createdAt`, `updatedAt`, and source revision;
- provenance/event reference;
- classification and retention label.

## 6. Data ownership and database boundaries

**Critical rule: retain separate ownership of every database, schema, migration stream, credential, and data lifecycle.** A shared ontology or API does not authorize cross-domain writes or merge independent persistence responsibilities.

| System | Authoritative responsibility | Boundary |
|---|---|---|
| Supabase Auth | Credential and authenticated identity authority | RyanAI identity bridge stores metadata only; never copies password hashes, sessions, or tokens |
| Main PostgreSQL | Application-owned transactional records | Main application domain; schema changes require reviewed migrations |
| Prisma | Application schema/client contract | Owns only explicitly application-managed tables and migrations |
| Supabase platform schemas | Supabase-managed platform objects | Do not let Prisma migrations silently take ownership of platform-managed schemas |
| pgvector | Vector indexes/embeddings associated with governed records | Embeddings are derived data; source record and access scope remain authoritative |
| Redis / Valkey | Cache, ephemeral coordination, queue acceleration | Not the sole durable record of mission, approval, audit, or evidence |
| Audiobook persistence | Separately scoped audiobook records | Separate connection/configuration and migration ownership; no accidental reuse of main DB |
| Object storage | Binary artifacts and large payloads | Scoped access, signed access, retention, integrity hashes; DB stores metadata and references |

Database ownership must be explicit in a machine-readable inventory before schema changes. Each table/schema must name its owning service, migration authority, data classification, retention policy, backup/recovery owner, and read/write interfaces.

### Data design rules

- PostgreSQL is transactional truth for application-owned records; Redis is not a substitute.
- Use foreign identifiers or controlled references across service boundaries; avoid cross-domain cascading deletes.
- Keep Supabase Auth credential authority separate from RyanAI application metadata.
- Keep Audiobook Studio persistence separately scoped.
- Store large/binary artifacts in object storage; persist metadata, hash, owner, classification, and retention in relational storage.
- Treat vectors, search indexes, caches, and ontology projections as derived/rebuildable data.
- Do not introduce a graph database until measured query/scale requirements justify its operational cost.
- Reconcile every proposed entity with existing Prisma/Supabase schemas before proposing migrations.
- No production migration is implied or authorized by this architecture document.

### Conceptual entity groups

These are logical candidates, not approved migration definitions:

- Mission: `missions`, `mission_dependencies`, `mission_acceptance_criteria`
- Work: `tasks`, `task_attempts`, `task_handoffs`
- Workforce: `agents`, `agent_capabilities`, `agent_runs`
- Governance: `policies`, `authorization_decisions`, `approvals`, `capability_grants`
- Ontology: `ontology_types`, `ontology_objects`, `ontology_relationships`
- Events: `events`, `event_outbox`, `event_consumers`
- Execution: `tool_registry`, `tool_invocations`, `execution_receipts`
- Memory: `memory_entries`, `memory_sources`, `memory_relationships`
- Evidence: `evidence_records`, `verification_results`
- Artifacts: `artifacts`, `artifact_versions`
- Intelligence: `model_registry`, `model_invocations`, `model_evaluations`

Before implementation, map each candidate to existing tables and services. Prefer extending an existing owner-managed aggregate over creating duplicate tables. Avoid a universal generic object table for transactional writes; typed domain tables plus ontology projections are easier to validate and govern.

## 7. Canonical service contracts

Contracts are versioned and independently enforce authentication, authorization, ownership, validation, rate limits, and audit requirements.

| Contract | Responsibility |
|---|---|
| Identity API | Resolve authenticated principal and scopes |
| Policy API | Evaluate authorization and return a bounded decision |
| Approval API | Request, grant, reject, expire, and revoke human approval |
| Mission API | Create, inspect, cancel, and reconcile missions |
| Task API | Manage task dependencies, attempts, leases, and handoffs |
| Ontology API | Resolve typed objects, relationships, lineage, and authorized search |
| Agent API | Register agents and expose bounded capabilities/health |
| Model API | Route inference and record model invocation/evaluation |
| Orchestration API | Coordinate mission/task lifecycle |
| Capability API | Discover and invoke registered tools through policy gates |
| Memory API | Store/retrieve scope-authorized, provenance-backed memory |
| Evidence API | Record evidence and evaluate acceptance criteria |
| Event API | Publish/consume versioned lifecycle events |
| Artifact API | Manage governed artifact metadata and access |

Proposed route family (logical, not a claim that routes exist):

```text
/api/v1/identity
/api/v1/governance/{policies,decisions,approvals}
/api/v1/missions
/api/v1/tasks
/api/v1/agents
/api/v1/models
/api/v1/ontology/{objects,relationships,search}
/api/v1/capabilities
/api/v1/memory
/api/v1/evidence
/api/v1/events
/api/v1/artifacts
/api/v1/workspaces
/api/v1/health
```

### Common API requirements

- Explicit request/response schemas and schema versioning.
- Authenticated principal and owner/tenant scope derived server-side, not trusted from request body.
- Stable error taxonomy: authentication, authorization, approval-required, validation, conflict, rate-limit, provider-blocked, unavailable, and internal.
- Idempotency keys for mutating or externally consequential operations.
- Correlation and causation identifiers for tracing.
- Pagination limits and bounded query complexity.
- No secrets or unrestricted provider payloads in logs.
- Backward-compatible evolution or an explicit version transition.

## 8. Event architecture

Use durable event publication for cross-domain coordination. Prefer a transactional outbox for events emitted from PostgreSQL transactions: write the domain change and outbox record atomically, then publish asynchronously. Consumers must be idempotent and maintain durable checkpoints. Redis may accelerate delivery but must not be the only durable event history.

Conceptual envelope:

```typescript
interface RyanAIEvent<T = unknown> {
  eventId: string;
  eventType: string;
  schemaVersion: string;
  missionId?: string;
  taskId?: string;
  actorId: string;
  actorType: "human" | "agent" | "system";
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  source: string;
  environment: "development" | "staging" | "production";
  ownerScope: string;
  payloadRef?: string;
  payload?: T;
}
```

Security requirements:
- validate schema and producer identity;
- derive and enforce owner scope at producer and consumer;
- use allowlisted event types and payload schemas;
- use `payloadRef` for sensitive/large data in protected storage;
- include integrity hashes where evidence requires them;
- deduplicate by event ID and idempotency key;
- handle retries, poison messages, dead-letter review, and replay authorization;
- never treat event delivery as proof that a downstream action completed.

Events describe facts that occurred; commands request work. Do not use one ambiguous message type for both.

## 9. Capability execution protocol

Every registered tool/capability declares:
- stable capability ID and owner service;
- input/output schema and schema version;
- required principal scope;
- resource types/actions supported;
- allowed environments and risk class;
- approval requirements;
- timeout, retry, and cancellation behavior;
- idempotency strategy;
- audit/evidence requirements;
- data classification and egress policy.

Standard execution protocol:

1. Receive a mission/task-scoped command.
2. Authenticate principal and resolve owner/resource scope.
3. Validate payload, schema, resource, and environment.
4. Ask Gen-X for a decision bound to the exact operation.
5. If approval is required, pause and obtain a verifiable, unexpired human approval.
6. Re-check policy/approval immediately before execution.
7. Execute through the least-privileged adapter identity.
8. Record execution receipt, provider response classification, and evidence references.
9. Verify postconditions independently.
10. Publish outcome event and submit eligible verified facts to Memory policy.

No direct unrestricted agent-to-database, agent-to-cloud-admin, or agent-to-production-infrastructure access. Agents use capability adapters. An adapter must fail closed if Gen-X is unavailable or a decision is expired/revoked.

## 10. Memory and institutional learning

Memory Vault has four distinct classes:

| Class | Meaning | Example |
|---|---|---|
| Episodic | What happened | A task attempt, incident, approval, repair |
| Semantic | Established knowledge | A verified service relationship or domain fact |
| Procedural | Verified how-to knowledge | A repeatable repair procedure with test evidence |
| Operational | Current/dated operational context | Service health observation, incident state, release evidence |

Each memory item carries provenance, owner scope, source reference, actor, timestamps, confidence/verification state, classification, retention policy, and expiry where applicable.

Memory admission rules:
- an agent assertion alone is not verified truth;
- distinguish observation, hypothesis, decision, execution result, and verified fact;
- preserve source evidence and confidence; never silently promote confidence;
- apply user/tenant authorization on retrieval, not only at ingestion;
- honor deletion, correction, retention, and legal/privacy requirements;
- prevent sensitive secrets and unnecessary personal data from entering general memory;
- make derived summaries traceable to their source records;
- keep memory writes policy-controlled and auditable.

Learning may improve prompts, routing recommendations, playbooks, and evaluation sets. It must not autonomously rewrite Gen-X policy, grant permissions, change safety thresholds, or authorize actions.

## 11. Evidence, verification, and observability

Evidence is a first-class product capability. A consequential operation should produce an evidence bundle containing, as applicable:

- mission/task/attempt IDs;
- actor and agent identity;
- repository, branch, exact commit SHA, and diff digest;
- authorization decision ID, policy version, and approval reference;
- capability and resource identifiers;
- execution start/end timestamps and outcome;
- tool invocation and provider correlation IDs;
- workflow/run/job IDs and exact-head status;
- test, lint, typecheck, build, security, and migration results;
- artifact hashes and protected locations;
- postcondition/acceptance-criteria verification;
- reviewer identity and final disposition.

Canonical evidence states:

`passed`, `failed`, `queued`, `skipped`, `cancelled`, `missing`, `provider_blocked`, `unverified`.

Never collapse these states into a boolean. Queued, skipped, configured, or started is not passed. A successful build is not a successful deployment; a successful deployment is not proof of healthy operation. A successful task is not a verified mission outcome.

Observability should correlate logs, metrics, traces, events, and evidence by mission/task/attempt/correlation IDs while redacting secrets and minimizing sensitive payloads.

## 12. Security and threat model

| Threat | Required mitigation |
|---|---|
| Prompt injection or malicious artifact content | Treat retrieved content as untrusted data; isolate instructions from data; capability allowlists; human review for high risk |
| Agent privilege escalation | Gen-X-only authorization; server-side scope checks; no agent-issued grants |
| Confused deputy / cross-tenant access | Derive owner scope from identity; bind policy to resource and tenant; test negative cross-scope cases |
| Approval replay or substitution | Bind approval to exact operation, payload digest, resource, environment, expiry, and one-time/idempotent use |
| Tool abuse or SSRF | Egress allowlists, destination validation, network isolation, constrained credentials |
| Secret leakage | Secret manager/runtime injection; redaction; no secrets in prompts, memory, artifacts, or logs |
| Event spoofing/replay | Authenticated producers, schema validation, signatures/integrity where needed, deduplication |
| Memory poisoning | Provenance, trust labels, admission policy, verification, correction and deletion path |
| Supply-chain compromise | Dependency review, SBOM, secret scanning, code/security analysis, pinned/reviewed build inputs |
| Evidence tampering | Append-only/tamper-evident records, hashes, restricted writers, independent verification |
| Fail-open dependencies | Deny consequential actions when policy, identity, approval, or evidence dependency is unavailable |
| Unsafe autonomy | Environment/risk gates, bounded task scope, explicit human approvals, cancellation and kill switch |

Security testing must include negative cases: expired approval, revoked policy, mismatched payload digest, wrong owner scope, cross-environment reuse, unknown capability, unavailable Gen-X, duplicate event, replayed command, and untrusted artifact instructions.

## 13. Workspace composition

Workspaces are views and domain applications over shared contracts; they are not separate authorization authorities.

| Workspace | Shared services and domain focus |
|---|---|
| Command Center | Mission intake, context, status, human decisions |
| Operator Console | Queue, task attempts, handoffs, cancellation, evidence |
| Admin Console | Governed identity/policy/configuration and audit |
| Cockpit | Cross-domain operational awareness and verified status |
| Studio | Projects, engineering missions, GitHub changes, reviews |
| Quant Lab | Historical research, isolated simulation, risk/evidence; no brokerage execution |
| Audiobook Studio | Media workflow and separately scoped persistence |
| Comms | Contacts/consent, provider events, approvals; live delivery gates |
| PhoneLink | Device identity, pairing, scoped capabilities |
| Inference Console | Model registry, routing, quality, latency, cost |
| Memory Vault | Authorized retrieval, provenance, retention, correction |

The UI may guide users but cannot enforce access by hiding controls. All sensitive operations are checked by backend policy and the capability adapter.

## 14. Infrastructure and delivery

The current RyanAI hosting boundary is **Render and Railway**. Vercel is excluded from this target architecture.

- Render and Railway responsibilities must be documented against the current service inventory and verified runtime evidence; do not infer a service role solely from a config file.
- CI commit/workflow evidence is the deployment trigger of record; a Docker build or image push alone does not prove a release occurred.
- Development, staging, and production identities, databases, queues, storage, and credentials must remain isolated.
- Production deploys, production DB migrations, secret changes/rotation, paid upgrades, and externally consequential communications require separate explicit human authorization.
- No architecture PR authorizes infrastructure changes, production deployment, database migration, or credential changes.
- Keep rollback procedures, backup/restore evidence, health checks, and release provenance attached to each production change.

## 15. Reliability and operational requirements

Define service-level objectives only after measuring current baselines. Initial design requirements:

- durable mission/task state independent of worker process lifetime;
- lease-based worker ownership with bounded expiry and recovery;
- idempotent retries and explicit terminal failure;
- cancellation propagation with truthful cancellation status;
- bounded queues, backpressure, and per-tenant fairness;
- circuit breakers and provider-specific failure classification;
- outbox/inbox delivery with deduplication;
- explicit degraded modes; no false healthy status;
- health endpoints distinguish liveness, readiness, dependency health, and capability readiness;
- recovery tests for worker crash, lease expiry, duplicate delivery, provider timeout, and database reconnect.

## 16. Architecture decision records

The following decisions are proposed and should be ratified through normal review before implementation.

| ADR | Decision | Rationale |
|---|---|---|
| ADR-001 | Mission is the top-level workflow aggregate | Keeps objectives, constraints, authority, and outcomes connected |
| ADR-002 | Gen-X is the only policy decision authority | Prevents model/agent privilege escalation |
| ADR-003 | Jarvis coordinates but does not authorize | Separates planning from permission |
| ADR-004 | Ontology is a semantic projection over domain-owned truth | Avoids duplicate transactional authority |
| ADR-005 | PostgreSQL remains transactional truth for app-owned records | Preserves existing persistence and migration ownership |
| ADR-006 | Redis is ephemeral acceleration, not sole durable truth | Supports recovery and audit |
| ADR-007 | Events use versioned schemas and transactional outbox where applicable | Reliable cross-domain coordination |
| ADR-008 | Execution uses registered capability adapters | Centralizes policy, validation, idempotency, and evidence |
| ADR-009 | Verification is independent from execution status | Prevents technical success being mistaken for mission success |
| ADR-010 | Memory admission is provenance- and policy-controlled | Prevents unverified claims becoming institutional facts |
| ADR-011 | Render and Railway are the hosting boundary; Vercel excluded | Matches current platform direction |
| ADR-012 | Production and external side effects remain separately human-gated | Preserves owner authority and safety boundaries |

## 17. Implementation roadmap and exit criteria

Implement incrementally. Do not create all proposed tables or services in one migration.

### Phase 0 — architecture and inventory (read-only)
- Inventory existing routes, services, Prisma models, Supabase migrations, event/queue mechanisms, policy checks, memory records, and evidence.
- Map each existing capability to owner service, data source, identity, authorization enforcement, and test coverage.
- Identify duplicate or overlapping contracts and unresolved ownership.
- Produce an as-is/to-be traceability matrix.

**Exit:** reviewed inventory with authoritative sources and explicit unknowns; no speculative readiness claims.

### Phase 1 — canonical contracts and governance
- Ratify identity, authorization, approval, mission, task, capability, and evidence contracts.
- Define policy decision binding, expiry, revocation, audit, and negative security tests.
- Define mission/task/verification state machines and transition invariants.

**Exit:** contract tests prove fail-closed authorization, scoped approval, idempotency, and lifecycle validity.

### Phase 2 — mission and orchestration foundation
- Reconcile existing task/agent-run models before schema proposals.
- Establish durable mission/task/attempt lifecycle, dependency graph, leases, cancellation, retries, and recovery.
- Keep Jarvis as coordinator behind Gen-X policy.

**Exit:** restart/retry/cancel/replay tests pass; no duplicate side effects; exact evidence per attempt.

### Phase 3 — ontology and event projections
- Define ontology type/relationship registry and source ownership.
- Add versioned event contracts and outbox/inbox only where required by existing transactional boundaries.
- Build rebuildable projections with provenance and owner-scope filtering.

**Exit:** projection can be rebuilt; source records remain authoritative; cross-scope access tests pass.

### Phase 4 — capability execution and evidence
- Inventory adapters and capability risk declarations.
- Enforce authorization immediately before every consequential execution.
- Add execution receipts, correlation, independent postcondition checks, and evidence bundles.

**Exit:** unknown/expired/revoked approvals fail closed; actions are auditable and idempotent.

### Phase 5 — memory and workspaces
- Classify current Memory Vault records and establish provenance/retention rules.
- Add admission/verification and retrieval-time authorization.
- Migrate workspace views onto shared mission, ontology, policy, and evidence contracts incrementally.

**Exit:** no unverified claim is promoted to verified memory; cross-workspace scope tests pass.

### Phase 6 — learning and optimization
- Establish offline, held-out evaluations for models and agents.
- Track reliability, latency, cost, retrieval quality, failure and recovery rates.
- Use evaluation outcomes to improve recommendations and procedures only.

**Exit:** reproducible benchmark evidence and human-reviewed changes; no autonomous policy or permission changes.

## 18. Required engineering deliverables

Before implementation PRs:
1. As-is/to-be component and dependency map.
2. Service ownership and data ownership registry.
3. API/event schemas with compatibility rules.
4. Threat model and security test matrix.
5. Mission/task/approval/verification state transition tables.
6. Existing schema reconciliation and migration ownership map.
7. SLO/SLI definitions based on measured baselines.
8. Staging validation and rollback plan for each stateful change.
9. Feature flags and explicit disabled-by-default boundaries for external side effects.
10. Human review checklist and evidence requirements.

## 19. Non-goals and explicit exclusions

This architecture does not authorize or propose:
- a Palantir clone or dependency on proprietary Palantir products;
- replacing PostgreSQL/Prisma/Supabase with a graph database;
- unrestricted autonomous agents or self-authorization;
- direct model access to production databases or infrastructure;
- automatic PR merges;
- live brokerage/order execution in Quant Lab;
- live WhatsApp/SMS/voice/email without provider callback verification, owner/destination verification, and explicit test authorization;
- production deployment or production database migrations;
- secret creation, modification, rotation, or exposure;
- paid infrastructure upgrades;
- Vercel hosting or execution.

## 20. Mission protocol: engineering repair example

1. **Intake:** Command Center records objective, constraints, owner, acceptance criteria, and environment.
2. **Resolve:** ontology identifies repository, branch, exact base SHA, tests, services, and dependencies.
3. **Authorize:** Gen-X evaluates read, branch, PR, and other requested capabilities independently. Production actions remain denied or approval-gated.
4. **Plan:** Jarvis decomposes work into bounded tasks and assigns eligible agents.
5. **Execute:** workers inspect and propose isolated changes through GitHub capability adapters.
6. **Verify:** CI, security, tests, and exact-head evidence run against the proposed SHA.
7. **Review:** human reviews diff and evidence; no automatic merge.
8. **Reconcile:** mission status is computed from acceptance criteria and evidence states.
9. **Remember:** only verified, policy-eligible outcomes become procedural or semantic memory.

The same protocol applies to infrastructure, database, communications, media, and research missions, with risk-appropriate approvals.

---

**Architecture summary:** RyanAI is mission-centric, authority-first, ontology-driven, capability-executed, evidence-verified, and memory-informed. Its autonomy is bounded by Gen-X and accountable to humans. The platform should be built by reconciling these target contracts with the repository's actual code and data ownership—not by assuming that a diagram is an implementation.
