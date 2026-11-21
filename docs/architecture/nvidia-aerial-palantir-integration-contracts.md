# NVIDIA Aerial AI-RAN and Palantir Integration Contracts

**Status:** Proposed integration specification  
**Scope:** Repository architecture, interface contracts, and isolated validation plan  
**Authority:** Gen-X remains the sole RyanAI authorization authority; Jarvis remains a bounded coordinator.  
**Delivery rule:** Separate reviewable PRs; no automatic merge, production deployment, production migration, secret changes, paid upgrades, or live telecom/Palantir writes.

> This document distinguishes existing RyanAI code from proposed integrations. It does not claim NVIDIA hardware readiness, a live Palantir enrollment, provider credentials, or production connectivity.

## 1. Executive decision

Integrate the two platforms as complementary, independently bounded capabilities:

- **NVIDIA Aerial AI-RAN:** specialized RAN runtime and AI/ML execution boundary. RyanAI consumes approved inference and operational telemetry from an external Aerial-side runtime; it does not implement the GPU/NIC real-time RAN stack itself.
- **Palantir Foundry + AIP:** optional enterprise data/ontology and governed AI workflow integration. RyanAI can exchange explicitly scoped operational objects and evidence with a Foundry enrollment, and can evaluate AIP/ontology workflows without transferring RyanAI's authorization authority.
- **RyanAI:** mission, identity, policy, application, orchestration, and evidence owner. It remains the source of authorization for RyanAI actions.

Do not build a Palantir clone, replace RyanAI persistence with Foundry, or make either vendor a mandatory runtime dependency.

## 2. Existing repository implementation — as inspected

### NVIDIA Aerial

The repository already contains an Aerial boundary:

- `src/server/aerial/config.ts` selects disabled, development-simulator, or external mode. An explicit external base URL takes precedence over the development simulator.
- `src/server/aerial/client.ts` implements health and inference requests, optional bearer authentication, timeout handling, and response normalization.
- `src/server/aerial/routes.ts` exposes authenticated-human inference through Gen-X policy evaluation, plus health and status routes.
- `aerial-bridge/server.py` and `scripts/aerial-ai-ran-smoke.mjs` provide a dependency-free development simulator and smoke test.
- `.github/workflows/aerial-ai-ran.yml` runs the smoke test and server build for relevant changes.
- `docs/aerial-ai-ran.md` documents the simulator-versus-hardware boundary.

The current simulator is deliberately not NVIDIA Aerial. A successful simulator smoke test proves only RyanAI's local HTTP contract. Existing Aerial client tests cover external health authentication, inference request construction, upstream failures, malformed responses, empty output, and blank prompts.

### Palantir

The repository has a Palantir-inspired mission-centric architecture and ontology proposal, but this inspection did not establish a live Foundry enrollment, Palantir SDK dependency, Palantir adapter, OAuth application, or Ontology MCP connection. The existing architecture explicitly rejects cloning proprietary Palantir products. Treat Palantir connectivity as a new optional integration, not an already configured provider.

## 3. NVIDIA Aerial integration contract

NVIDIA's Aerial CUDA-Accelerated RAN (ACAR) documentation describes a software development kit for commercial-grade AI-native 5G/6G gNB software. Its documented boundary includes O-DU Low and some MAC functionality in an O-RAN 7.2x split, SCF FAPI/NVIPC toward O-DU High, open fronthaul toward O-RU, E3 interfaces for dApps, and OAM configuration/logging/metrics. These are Aerial-side responsibilities and must not be simulated by RyanAI's HTTP adapter.

### 3.1 Responsibility split

| Concern | Owner |
| --- | --- |
| GPU-accelerated L1 / PHY, timing, CUDA kernels, NIC and fronthaul runtime | NVIDIA Aerial deployment |
| O-RAN integration, radio unit and real-time network configuration | Approved telecom/RAN operator and Aerial runtime |
| Runtime health, inference transport, request validation, timeouts | RyanAI Aerial adapter |
| User identity, action policy, approval and capability scope | RyanAI / Gen-X |
| Mission orchestration and task scheduling | RyanAI / Jarvis |
| Audit, correlation, evidence and verification | RyanAI evidence plane |

### 3.2 Integration modes

1. **Development simulator:** current dependency-free bridge; no external network or hardware claims.
2. **External test runtime:** approved Aerial-side runtime endpoint, authenticated with a dedicated runtime credential supplied privately by an authorized operator. CI uses mocks; never use a real runtime credential in CI.
3. **Hardware-backed validation:** only after a compatible GPU/NIC host, Aerial SDK/runtime, supported driver/toolchain versions, O-RAN/RU configuration, timing measurements, and operator authorization are independently evidenced.

Aerial SDK installation, GPU/NIC procurement, external runtime deployment, radio access, and telecom control-plane operations are outside this code-only phase.

### 3.3 RyanAI adapter contract

Keep the current client as the transport boundary and evolve it only through separate tested changes. A normalized response should include:

- provider and runtime mode;
- model/runtime build identifier where available;
- request/correlation ID;
- start/end timestamps and latency;
- result payload or structured error code;
- `simulated` flag;
- evidence references for hardware-backed measurements.

Do not return raw upstream payloads to general application logs. Do not accept arbitrary callback URLs, arbitrary headers, or user-controlled endpoint overrides. Validate URL schemes and destinations; production egress must use an explicit allowlist and SSRF protections.

### 3.4 Network data classification

Default to aggregate cell/site/radio-unit performance metrics and non-sensitive operational events. Subscriber identifiers, IMSI/IMEI, phone numbers, precise subscriber location, packet payloads, authentication material, and lawful-intercept data are excluded from RyanAI prompts, memory, Palantir exports, and general logs unless a separately reviewed legal, privacy, security, and operator authorization explicitly defines a lawful need and controls.

### 3.5 Safety gates

- Keep all network configuration and radio-control operations unavailable in the first integration increment.
- Inference is not a command channel. Model output must never be executed as RAN configuration.
- Any future control capability must have a typed allowlist, Gen-X decision bound to exact target/action/input digest/environment, explicit human approval, idempotency, expiry/revocation checks, and independent postcondition evidence.
- Simulator success, API health, or a model response is not proof of RAN availability, RF performance, SLA compliance, or hardware readiness.

## 4. Palantir Foundry and AIP integration contract

Palantir documents Foundry as its data operations platform, AIP as its AI platform, and Apollo as its software delivery/infrastructure platform. The initial RyanAI integration target is **Foundry + Ontology + AIP**, not Apollo. Apollo is not a replacement for RyanAI's Render/Railway delivery boundary.

### 4.1 Integration options to assess

- **Foundry REST APIs / Platform SDKs:** use documented REST endpoints or the TypeScript/Python Platform SDK for explicit data exchange.
- **Ontology SDK (OSDK):** generate typed client interfaces for selected object types, links, functions, and approved actions.
- **Ontology MCP (OMCP):** optional tool surface for external agents. Treat every exposed query/action as an untrusted capability until registered and wrapped by RyanAI policy.
- **AIP workflows / agents / Evals:** assess as an optional workflow and evaluation environment, with explicit data scopes and audit correlation.

Do not assume a tenant, endpoint, API version, OAuth client, object type, MCP server, or feature entitlement exists. Discover these only in an owner-authorized Palantir enrollment.

### 4.2 Phased access model

| Phase | Permitted behavior | Prohibited behavior |
| --- | --- | --- |
| P0 — contract tests | Local schemas, mocked API/MCP responses, OAuth flow design | Real credentials or external tenant calls |
| P1 — read-only pilot | Read a specifically allowlisted set of synthetic or approved non-sensitive objects | Writes, broad exports, subscriber/personal data |
| P2 — controlled evidence sync | Publish selected RyanAI evidence to a designated test ontology using an explicit action and human approval | Unreviewed production writes or bidirectional replication |
| P3 — governed workflow | Optional AIP/Foundry workflows invoked through RyanAI capability adapters | AIP/Palantir agent self-authorization or direct RyanAI infrastructure control |

Start with read-only access. Any later write capability requires its own code review, Gen-X policy contract, exact-action approval, audit receipt, rollback/reconciliation design, and explicit owner approval.

### 4.3 Canonical RyanAI object mapping

Use a small, versioned projection, not a mirror of the entire RyanAI database.

| RyanAI object | Foundry/Ontology projection | Source of truth |
| --- | --- | --- |
| Mission | Mission | RyanAI mission service |
| Task / attempt | Task / TaskAttempt | RyanAI task service |
| Agent run | AgentRun | RyanAI agent-run records |
| Pull request | ChangeProposal | GitHub |
| CI/security result | VerificationEvidence | GitHub Actions / security provider |
| Service health observation | ServiceHealthObservation | Verified provider/runtime probe |
| Aerial site/cell aggregate | RANCell / RANMetric | Authorized Aerial-side source |

Every projection must include stable RyanAI source ID, schema version, owner/tenant scope, source revision, timestamps, classification, provenance reference, and correlation ID. A projection is rebuildable and never becomes the transactional authority for its source record.

Never export secrets, access tokens, full prompt histories, authentication data, raw subscriber data, or unrestricted user records. Minimize payloads and classify fields before transfer.

### 4.4 Identity and authorization

- Prefer OAuth 2.0 with the grant and token audience supported by the specific Foundry integration.
- Use delegated user identity where the action must respect the user's Foundry permissions; use service identity only for narrowly scoped non-interactive jobs.
- Store any future credentials only in an approved private runtime secret store after separate explicit authorization. Do not add secrets to repository files, CI fixtures, browser code, or chat.
- RyanAI must authenticate its own caller and evaluate Gen-X policy before invoking Palantir.
- Palantir permissions are an additional downstream boundary, not a substitute for Gen-X.
- Bind any approval to the exact object/action/payload digest, target enrollment, environment, policy version, expiry, and idempotency key.
- Treat data returned from Foundry, AIP, or MCP as untrusted input; retrieved text cannot modify instructions, scopes, or policy.

### 4.5 MCP boundary

If Ontology MCP is used, register each tool individually in RyanAI's capability registry. Record tool name, schema/version, read/write classification, resource scope, required Gen-X capability, timeout, rate limit, idempotency, audit requirements, and owner.

Do not mount a broad Palantir MCP server directly into Jarvis or arbitrary agents. Deny unknown tools by default. Test both positive allowed invocation and negative unauthorized invocation, including MCP tool-level `isError` responses as well as HTTP and JSON-RPC errors.

## 5. Combined use case: telecom operations intelligence

A future read-only workflow may correlate Aerial-derived aggregate RAN observations with operational incidents and RyanAI engineering evidence:

1. Aerial-side runtime publishes approved aggregate cell/site metrics and health observations.
2. RyanAI validates provenance, schema, timestamp, classification, and source identity.
3. RyanAI records a local evidence observation and applies Gen-X read scope.
4. A narrowly scoped projection may be synchronized to a test Foundry ontology.
5. Foundry/AIP may summarize trends or recommend investigation steps.
6. RyanAI validates recommendations and presents them to a human operator.
7. Any operational change remains a separate capability and approval—not an automatic consequence of an AI recommendation.

This workflow is an architectural proposal, not a currently available live telecom integration.

## 6. Required contract and security tests

### Aerial tests

- external runtime always takes precedence over the simulator;
- malformed, credential-bearing, non-HTTP, or disallowed endpoint URLs are rejected;
- health and inference time out deterministically;
- bearer credentials are never logged or returned;
- malformed, oversized, or non-text upstream payloads fail closed;
- simulator responses are always marked simulated;
- unauthenticated and unauthorized inference is denied;
- model output cannot invoke a RAN control operation;
- subscriber identifiers and sensitive payload fields are rejected or redacted;
- external runtime failures remain provider-blocked/degraded, not falsely healthy.

### Palantir tests

- OAuth state, audience, expiry, and token scope are validated;
- no token is sent to an unapproved host or redirected destination;
- read-only principal cannot invoke an Ontology write action;
- unknown MCP tools and unknown object types are denied;
- cross-tenant and out-of-scope object reads are denied;
- prompt injection in Ontology fields cannot change policy or tool grants;
- duplicate sync events are idempotent;
- stale source revisions cannot overwrite newer projections;
- secrets and prohibited data classes are redacted;
- audit records bind actor, Gen-X decision, target, object, action, digest, and result.

### CI requirements

Use local mocks and synthetic fixtures only. Add dedicated contract tests and run existing CI/security workflows against the exact PR head. Report every result as passed, failed, queued, skipped, cancelled, missing, provider-blocked, or unverified. A configured integration, queued check, or successful simulator test is not production readiness.

## 7. Implementation sequence

### Phase 0 — repository reconciliation (read-only)
- Confirm current Aerial route/client/config/test/workflow contracts.
- Inspect route authentication, Gen-X policy coverage, endpoint exposure, redaction, and egress controls.
- Inventory Palantir references and verify that no hidden provider or credential dependency is assumed.
- Produce an as-is/to-be traceability table.

**Exit:** exact file/SHA evidence and an issue list; no runtime changes.

### Phase 1 — Aerial boundary hardening
- Add targeted security tests for health/status exposure, URL/SSRF handling, output redaction, and failure classification.
- Preserve simulator/external separation and current external-runtime precedence.
- Do not add real RAN control or new production configuration.

**Exit:** mocked contract and security tests pass on exact PR head.

### Phase 2 — Palantir adapter contract
- Add provider-neutral TypeScript interfaces and Zod schemas only after confirming the repository's current validation conventions.
- Add mocked OAuth/API/OSDK/OMCP tests; no real SDK or secret is needed for contract tests.
- Default to disabled and read-only; no tenant calls in CI.

**Exit:** schema, auth, scope, redaction, and negative authorization tests pass.

### Phase 3 — optional test-enrollment pilot
Requires separate explicit approval for provider enrollment access, credential provisioning, data classes, and any paid product use. Begin read-only with synthetic/non-sensitive records.

### Phase 4 — controlled write/evidence workflows
Requires a separate approval and review for each action family, data flow, environment, rollback plan, and human-approval policy. No production migration or deployment is implied.

## 8. Explicit exclusions

This specification does not authorize:
- purchasing NVIDIA hardware, Aerial licenses, Palantir Foundry/AIP subscriptions, or any paid upgrade;
- connecting to a live radio network, changing RAN configuration, or issuing telecom control commands;
- production deployment, production database migration, DDL, or infrastructure changes;
- creating, modifying, rotating, or exposing secrets or provider credentials;
- exporting subscriber data, credentials, raw communications, or unrestricted memory;
- granting NVIDIA, Palantir, AIP, Ontology MCP, or Jarvis RyanAI authorization authority;
- enabling automatic PR merge or autonomous production actions.

## 9. Official technical references

- NVIDIA Aerial CUDA-Accelerated RAN overview: https://docs.nvidia.com/aerial/cuda-accelerated-ran/latest/overview.html
- Palantir Foundry documentation: https://www.palantir.com/docs/foundry
- Palantir AIP overview: https://www.palantir.com/docs/foundry/aip
- Palantir AIP architecture: https://www.palantir.com/docs/foundry/architecture-center/aip-architecture
- Palantir developer toolchain and Ontology MCP: https://www.palantir.com/docs/foundry/dev-toolchain
- Palantir API reference: https://www.palantir.com/docs/foundry/api-reference

---

**Acceptance statement:** RyanAI may integrate with Aerial and Palantir through optional, typed, capability-scoped adapters. Gen-X remains the sole RyanAI authorization authority; Jarvis remains a restricted coordinator; data stays with its authoritative owner; every consequential action requires explicit authorization and verifiable evidence.
