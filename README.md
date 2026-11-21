# RyanAI — Autonomous Reasoning Platform

## Documentation and execution baseline — 21 November 2026

> This addendum is the current operational correction to older historical notes below. Where a dated historical paragraph conflicts with this baseline, use the newer exact-commit evidence and the owning workflow/runbook.

- **Verified repository main at documentation start:** `daf185b348917e5c63f1b0b33917a65d9faabb25` (PR #652, Comms Prisma relation/migration-history reconciliation). This is a repository snapshot, not a claim that every workflow or deployment is green.
- **Comms execution model:** inbound admission is durable and idempotent; a crash while an operation is `in_flight` must recover through an explicit uncertain/provider-reconciled path. AgentRun execution state is distinct from append-only provider delivery receipts. A callback may update dispatch/delivery projections but must not rewrite the AgentRun or message execution state as if delivery were execution.
- **Comms schema:** PR #652 removed duplicate legacy Comms Prisma model declarations and reconciled relations against committed migration history. Migration ownership and replay order remain authoritative; do not use schema push or rewrite historical migrations as a shortcut.
- **Deployment CI topology:** CI/release evidence must cover **Railway (primary gate), Render, Vercel, and MCP/MCP servers**. Each target needs an exact-head workflow result, provider deployment identifier, and runtime/health evidence. A queued, skipped, cancelled, missing, or provider-blocked job is not a pass. A successful build is not proof of deployment. No auto-merge.
- **Release controls:** focused repair branches and PRs are permitted. Human review and required CI/security checks remain mandatory. Production deployment, production database migrations, secret changes, paid upgrades, and production infrastructure mutations remain separately approval-gated.
- **Communications safety:** provider configuration is not sender verification or delivery. Live WhatsApp/SMS/voice/email requires valid provider callbacks/signature checks, verified owner and destination, and explicit test authorization. Never publish credentials or claim delivery without provider evidence.
- **Documentation ownership:** README is the entry point; `AGENTS.md` is the engineering contract; `agent.md` and `RyanAI.agent.skills.md` define agent operating/skill boundaries; `test.md` defines verification; `RyanAI architecture, security and patches.md` records architecture and safe patch rules; `RyanAI Documents.md` is the canonical index. Detailed source, migrations, workflow files, and runbooks override summaries.
- **Current hosting responsibility mapping:** Railway is the primary release gate and persistent-workload target; Render and Vercel are independent CI/deployment targets in the release topology; MCP and MCP servers have their own build, authentication, discovery, and health gates. The precise service-to-provider mapping must be read from the current workflow and service configuration, not inferred from this summary.


RyanAI is an AI-assisted, human-governed engineering and operations platform. It brings together conversational assistance, agent orchestration, model routing, durable memory, software workspaces, communications, audiobook production, quantitative research, and operational controls behind authenticated APIs and reviewable workflows.

> **Authority principle:** AI proposes. Gen-X authorizes. Jarvis coordinates. Tools execute. Systems report. Evidence proves. Memory remembers. Humans retain approval authority wherever policy requires it.

This README describes the application and contracts present in this repository. It does not claim that every integration is connected, every workflow is passing, or every service is deployed. A source file, configured provider, queued job, green unit test, or healthy process is not by itself proof of end-to-end production readiness.

**Documentation baseline (21 November 2026):** implementation notes and links below are reconciled against the accessible canonical mainline through the latest verified repository commits. The README is an index and summary; the relevant source, migration, runbook, workflow, and pull-request evidence remains authoritative. Historical snapshot reference only; see the current documentation baseline below.

## Contents

- [Product overview](#product-overview)
- [Implementation record — 18–21 November 2026](#implementation-record--1821-november-2026)
- [Current readiness notes — 21 November 2026](#current-readiness-notes--21-november-2026)
- [Architecture](#architecture)
- [Mission-centric target architecture](#mission-centric-target-architecture)
- [Core workspaces](#core-workspaces)
- [Agent authority and execution lifecycle](#agent-authority-and-execution-lifecycle)
- [Models and inference](#models-and-inference)
- [Memory and data architecture](#memory-and-data-architecture)
- [Security and governance](#security-and-governance)
- [Technology stack and requirements](#technology-stack-and-requirements)
- [Local development](#local-development)
- [Environment configuration](#environment-configuration)
- [Database setup and migrations](#database-setup-and-migrations)
- [Testing and validation](#testing-and-validation)
- [Containers and deployment configuration](#containers-and-deployment-configuration)
- [Operational readiness and troubleshooting](#operational-readiness-and-troubleshooting)
- [Repository map](#repository-map)
- [Contribution workflow](#contribution-workflow)
- [Security reporting](#security-reporting)

## Product overview

RyanAI is a modular platform, not a single chat endpoint.

| Workspace | Purpose |
| --- | --- |
| Command / personal assistant | Authenticated conversational and voice-led assistance |
| Operator and operations | Task execution visibility, handoffs, status, and operational controls |
| Admin Console | Administrative visibility and governed configuration |
| Darkside Copilot / Cockpit | Mission-oriented command surface and operational awareness |
| RyanAI Studio | Project briefs, coding workbench, project history, workforce, handoffs, and evidence |
| Quant Lab | Historical-data research and simulated strategy analysis; not brokerage execution |
| Audiobook Studio | Audiobook production workflows and separately scoped persistence |
| Comms | Communication orchestration with explicit provider and action gates |
| PhoneLink | Mobile/device pairing and scoped device bridge |
| Memory Vault | Owner-scoped durable conversation, reasoning, and operational memory |
| GitHub / inference integrations | Governed repository workflows and model/provider access |

Some workspaces may be present in the frontend before their provider, adapter, database path, or device integration is operational. Check health endpoints, persisted state, workflow evidence, and provider callbacks before treating a capability as live.

## Architecture

RyanAI separates user experience, API execution, durable state, background work, model access, and external integrations.

~~~text
Web / mobile / desktop clients
            |
            v
   Authenticated application API
            |
    +-------+-------------------------------+
    |                                       |
    v                                       v
Gen-X policy and approvals           Application services
    |                                 (Studio, Comms, Quant,
    |                                  Audiobooks, Memory,
    |                                  PhoneLink, GitHub)
    v                                       |
Jarvis orchestration                         v
    |                                Durable queues / events
    v                                       |
Capability-scoped tools <-------------------+
    |
    +---- model/provider adapters
    +---- GitHub and connected services
    +---- communication providers
    +---- isolated research workers

Persistence: Supabase/PostgreSQL + pgvector, Redis, and
separately scoped audiobook storage/database connections.
~~~

### Authority boundaries

- **Gen-X** is the authorization and policy authority. Models and agents cannot grant themselves permissions.
- **Jarvis** coordinates approved work and delegates through bounded interfaces. Coordination does not confer authorization.
- **Ryan and specialist agents** can reason, propose plans, and execute only capabilities granted to their server-side identity and task.
- **Tools and adapters** enforce scopes, input validation, timeouts, idempotency, and audit requirements.
- **Human approval** remains mandatory for privileged or externally consequential actions as defined by policy.
- **Evidence** records what actually happened. Intent, configuration, queued work, skipped checks, and provider setup must not be reported as completed execution.

### Hosting and deployment boundaries

The repository contains Render and Railway configuration. The checked-in Render Blueprint describes web and API services; railway.json describes a Docker API service and health check. These files are configuration contracts, not proof that a deployment is active or healthy.

The current deployment model must be verified against the live service source and exact commit before any release. Do not infer that a successful image build triggered a deployment: inspect the deployment workflow and commit-based trigger. Vercel is not part of the current RyanAI hosting architecture.

### RyanAI Hybrid OS v1

RyanAI's approved operating-system architecture combines three specialized environments under one security and recovery model. It is an operating model built from separate operating systems, not a new Linux distribution.

- **Ubuntu LTS — Core host target:** the baseline for an operator-managed Ubuntu host if RyanAI later runs on infrastructure where the OS is under operator control. It is not the currently evidenced OS of the managed Render/Railway hosting environment.
- **Kali Linux — Security Zone:** an isolated environment for authorized security assessment and defensive testing. It is not a production runtime dependency and receives no standing production credentials.
- **Raspberry Pi OS 64-bit — Edge:** controlled physical nodes for voice/audio, sensors, GPIO, cameras, local interfaces, and limited edge inference. Each device requires a unique identity and authenticated encrypted gateway connection.
- **Security Fabric:** shared identity, authentication, Gen-X authorization, encrypted transport, audit, and telemetry across trust zones.
- **Recovery Layer:** independently controlled integrity verification, backup restoration, isolation, and rebuild procedures.

The initial trust zones are **CORE**, **SECURITY**, **EDGE**, **MANAGEMENT**, and **RECOVERY**. Inter-zone traffic is default-deny and must be explicitly scoped and authenticated. No agent or model may self-authorize; consequential execution follows capability validation, Gen-X policy, human approval where required, exact-action execution, and an audit/evidence receipt.

Architecture approval is documentation approval only. It does not authorize hardware procurement, production deployment, production database changes, secret changes, infrastructure changes, or paid upgrades. Implementation must proceed through reviewed phases and evidence gates.

Current implementation distinction: Render and Railway manage their underlying hosts. The checked-in API Dockerfiles use `node:24-alpine`; this is a container base image, not an Ubuntu host. The CORE zone is therefore a logical trust boundary today. An operator-managed Ubuntu host remains a future target and would require a separately reviewed infrastructure decision.

Detailed specifications:
- [Hybrid OS v1 architecture](docs/hybrid-os-v1.md)
- [Ubuntu Core Phase 1 repository audit](docs/architecture/ubuntu-core-phase1-audit.md)
- [Security architecture](docs/security/hybrid-os-security.md)
- [Raspberry Pi edge platform](docs/hardware/ryanai-edge.md)
- [Recovery and integrity layer](docs/recovery/ryanai-recovery.md)
- [Implementation validation matrix](docs/implementation/hybrid-os-v1-validation.md)

## Mission-centric target architecture

RyanAI's proposed next-stage operating model is documented in the [Mission-Centric Operating Architecture](docs/architecture/mission-centric-operating-architecture.md).

The target architecture organizes the platform around twelve domains and four independently governed planes:

- **Control:** identity, Gen-X policy decisions, approvals, and capability authority.
- **Intelligence:** ontology, context, models, agents, memory retrieval, and Jarvis coordination.
- **Execution:** authenticated APIs, workers, capability adapters, integrations, and workspaces.
- **Evidence:** audit records, events, traces, CI/security results, verification, and provenance.

Its operating sequence is **Mission → Authority → Reality → Reasoning → Coordination → Authorized execution → Verification → Institutional memory**.

The architecture makes an important distinction between proposed target state and implemented repository behavior. It does not claim that every proposed service, API, table, policy, or workflow already exists. The ontology is a semantic layer over domain-owned records, not a replacement for PostgreSQL or existing migration ownership. Gen-X remains the authorization authority; Jarvis coordinates but cannot grant permissions. Consequential execution is performed through bounded capability adapters and independently verified.

The document also defines database ownership boundaries, canonical service contracts, event and memory governance, a threat model, architecture decision records, and a phased implementation roadmap. It does not authorize production migrations, deployments, infrastructure changes, secret changes, paid upgrades, automatic merges, or live external communications.

## Core workspaces

### RyanAI Studio

Studio owns project intake and lifecycle semantics. Its documented current execution adapter delegates to the existing Jarvis agent-run queue and reports that it is not an independent Studio runtime. A future independent runtime requires durable scheduling, dependency handling, leases/retries, cancellation, worker heartbeats, recovery, and persisted evidence.

A project request should contain an objective, deliverables, acceptance criteria, and constraints. The API persists the task and returns a durable identifier. Queued or running work is not completion. Repository changes require a proposal tied to an exact base commit and diff, review, required CI/security evidence, and human approval.

See [Studio architecture and lifecycle](docs/studio/README.md).

### Quant Lab

The Quant Engine is a dependency-free Python research component. Its documented strategies include deterministic historical SMA crossover, RSI mean-reversion, AR(1) trend, and volatility research baselines (EWMA, fixed-parameter GARCH and EGARCH). It uses caller-supplied historical bars; it is not a market-data feed, broker, or live trading system.

- Paper/research outputs are simulations, not investment advice or evidence of profitability.
- No brokerage connection or real-order execution is implied by the engine.
- Strategy validation requires out-of-sample evidence and explicit risk controls.
- Run tests with: python3 -m unittest discover -s quant-engine/tests -v

See [Quant Engine documentation](quant-engine/README.md).

### Communications and attachments

Comms routes and provider adapters are subject to server-side capability checks, owner authorization, idempotency, and human approval where required. A configured provider is not proof of an authenticated sender or delivered message. Live WhatsApp, SMS, voice, and email actions require verified provider callbacks, destination/owner verification, and explicit test authorization. Keep communication and attachment features disabled until their complete safety and provider checks are evidenced.

### Twilio account and communications readiness

Twilio is the planned provider for RyanAI WhatsApp, SMS, and inbound/outbound voice. The Render service contract declares the server-side variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `TWILIO_WHATSAPP_NUMBER`. Configure these only in the private API runtime environment; never use `VITE_*` names or commit real values.

Provider account status, sender verification, callback configuration, trial restrictions, and billing state must be checked directly in the provider console at the time of activation. This README does not assert that an account is verified, paid, upgraded, or currently able to send. Any paid change requires separate owner approval.


Before enabling live Comms, verify the Account SID and Auth Token privately, confirm the purchased/verified sender resources and WhatsApp sender approval as applicable, configure HTTPS inbound/status/voice callbacks, validate Twilio request signatures, and verify callback delivery. Then obtain explicit owner authorization for a test destination and test window. Do not send messages or place calls merely because credentials are present. Keep `COMMUNICATIONS_ENABLED=false` until all gates are evidenced. No account SID, auth token, phone number, or billing details belong in README, source control, logs, screenshots, or chat.

### Audiobook Studio

Audiobook services use separately scoped database configuration. Do not assume the main application database and audiobook database are interchangeable. Keep pooled application traffic separate from direct/unpooled migration connections where the provider requires it. Audiobook schema work must be validated on its designated staging branch before any production request.

### PhoneLink

PhoneLink provides a scoped mobile/device bridge. Pairing, device authorization, native integration, and physical-device verification are separate milestones. A visible UI or registered device record is not proof that a physical device is connected and working.

## Agent authority and execution lifecycle

A typical governed task follows this lifecycle:

1. An authenticated owner submits a scoped objective and acceptance criteria.
2. The API validates the request, checks owner access, and rejects credential material.
3. Gen-X evaluates the requested capability, risk, and approval requirements.
4. Jarvis coordinates only the approved task and delegates to eligible workers.
5. Workers execute through least-privilege adapters with timeouts and idempotency.
6. Events, handoffs, results, and errors are persisted with provenance.
7. The application reports an honest state: queued, running, waiting_for_approval, blocked, succeeded, failed, or cancelled.
8. A human reviews privileged outcomes and approves any separately gated action.

A task request does not authorize production deployment, production database migration, secret changes, paid upgrades, or outbound communications. An agent must not approve its own privileged action.

## Models and inference

The codebase contains provider adapters and model configuration for OpenAI-compatible endpoints, NVIDIA, Qwen/Together, and other optional providers. Model names and defaults are configuration, not proof of API-key validity, provider availability, spend authorization, or benchmark qualification.

- Keep provider keys server-side; never expose them through Vite variables or browser bundles.
- Use explicit model allowlists and server-side routing policy.
- Record provider, model identifier, configuration provenance, latency, errors, and cost where supported.
- Do not let a model select its own permissions or bypass Gen-X.
- Model comparisons require a separate offline benchmark harness, held-out data, provenance, scorer, cost accounting, and adversarial policy tests.
- The documented benchmark operational-readiness phase is mock-only. A harness pass is not a model-gate pass and does not authorize provider calls or production activation.

See [benchmark operational readiness](docs/architecture/BENCHMARK-OPERATIONAL-READINESS.md).

## Memory and data architecture

RyanAI uses PostgreSQL as authoritative application persistence, with pgvector available for vector search. Redis supports cache/queue use cases. Supabase owns Auth-linked profiles, conversations, messages, memory entries, Storage buckets, and their RLS/grant policies. Prisma owns application schema such as agent runs and application operations. Audiobook persistence is separately scoped.

Important ownership rules:

- supabase/migrations/ owns Supabase platform objects, Auth-linked data, Storage policies, and Supabase-specific Comms objects.
- prisma/migrations/ owns application objects represented by the Prisma schema.
- Some Supabase-owned tables are mapped in Prisma for application access; that mapping does not transfer migration ownership.
- Supabase and Prisma migration histories are separate and must be replayed in the documented order.
- Never use db push, local reset, or an unreviewed migration as a production repair.
- Use synthetic or sanitized data in staging. Never copy production secrets, personal data, or real user audio into test environments.

See [database migration ownership and local setup](supabase/README.md).

## Security and governance

The engineering contract is defined in [AGENTS.md](AGENTS.md), with vulnerability handling in [SECURITY.md](SECURITY.md).

- Human review and required CI/security checks are mandatory before merge.
- No automatic merge or bypass of required checks.
- No production deployment without separate explicit approval.
- No production database migration without separate explicit approval and staging evidence.
- No secret creation, modification, rotation, or exposure without explicit authorization.
- No paid resource upgrades or production infrastructure changes without explicit authorization.
- Use least-privilege, short-lived identities where supported.
- Secrets belong in protected environment settings or a secret manager, never source control.
- Production data and developer home directories must not be mounted into agent sandboxes.
- Unknown, stale, skipped, queued, cancelled, or unverifiable evidence is not a pass.
- Preserve TLS certificate verification. Do not disable certificate validation to work around connectivity problems.

## Technology stack and requirements

The repository includes the following technologies; actual use depends on the service/module being run.

| Layer | Technology |
| --- | --- |
| Web UI | React, TypeScript, Vite |
| API / services | Node.js, TypeScript |
| Styling / UI | Tailwind CSS and component utilities |
| Data | PostgreSQL, Prisma, Supabase, pgvector |
| Cache / queue infrastructure | Redis |
| Agent / model integrations | Provider adapters, LangGraph examples and MCP |
| Python research | Python 3 and Quant Engine |
| Containers | Docker and Docker Compose |
| Deployment configuration | Render and Railway |
| Mobile / desktop | Android PhoneLink and Tauri-related workspace |

For the main application:

- Node.js 24.x as declared in package.json.
- npm 10 or newer; package manager declaration is npm 10.9.2.
- Git.
- PostgreSQL with pgvector for database-backed development.
- Redis for features that require cache/queue services.
- Supabase CLI for local Supabase Auth/Storage and migration workflows.
- Docker Engine and Docker Compose v2 for container-based development.
- Python 3 for optional Python tooling and Quant Engine tests.

Optional modules may require additional provider accounts, native build tools, Android tooling, Rust/Tauri dependencies, or service-specific credentials.

**Runtime compatibility note:** package.json declares Node.js 24.x and the checked-in API Dockerfiles use `node:24-alpine`. Keep the package engine and container base aligned, and verify the exact image digest and runtime version in release evidence.

## Local development

### 1. Get the source

~~~bash
git clone https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main.git
cd RYANAI-Automous-Reasioning-Plat-main
~~~

Use the canonical repository and branch approved for your work. The checked-in Render Blueprint currently names `ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main` on `main`; verify the live Render service's connected repository and deployed commit before any release.

### 2. Install dependencies

~~~bash
npm ci --include=dev --legacy-peer-deps
npm --prefix mcp-server ci --include=dev
npm --prefix workflows-ryanai ci --include=dev
~~~

The root install:all script performs these three installs.

### 3. Configure local environment

~~~bash
cp .env.example .env
~~~

Edit .env locally. The template is a starting point, not a complete secret generator. Docker Compose additionally requires local values for DB_PASSWORD, REDIS_PASSWORD, and JWT_SECRET. Use unique development-only values. Do not paste credentials into issues, pull requests, chat, screenshots, or source files.

### 4. Start development services

~~~bash
npm run dev
~~~

The root development command starts the API, web client, and MCP HTTP service concurrently. For narrower work:

~~~bash
npm run dev:api
npm run dev:web
npm run dev:mcp
~~~

The API development entrypoint is src/server/launcher.ts. The Vite client is served by the web development script. The MCP server has its own package and scripts under mcp-server/.

### 5. Build

~~~bash
npm run build:web
npm run build:server
~~~

The root build script builds the web client. The server build is separate and copies required server assets. Database client generation is wired into prebuild hooks; schema and generated-client consistency must still be checked.

### 6. Start the production-style API locally

After a successful server build and environment setup:

~~~bash
npm start
~~~

The package start command launches dist/server/server/launcher.js. Confirm the actual configured port and health route for the selected environment.

## Environment configuration

Use `.env.example` as the canonical local variable template. `env.frontend.example` is a legacy frontend-focused template; keep it aligned when frontend-only setup instructions are needed. It includes these groups:

| Group | Representative variables | Handling |
| --- | --- | --- |
| Browser-safe frontend | VITE_API_BASE_URL, VITE_APP_ENV, VITE_SUPABASE_URL, public/publishable Supabase key | VITE_ values are bundled into browser assets; never put secrets here |
| API runtime | HOST, PORT, NODE_ENV, CORS_ORIGINS | Set per environment |
| Database | DATABASE_URL, DB_PASSWORD | Server-side only; use the correct pooled/direct endpoint for the operation |
| Redis | REDIS_URL, REDIS_PASSWORD | Server-side only |
| Model providers | OPENAI_API_KEY, NVIDIA_API_KEY, QWEN_API_KEY and endpoint/model settings | Optional; enable only after provider and spend authorization |
| Twilio communications | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWILIO_WHATSAPP_NUMBER | Private API runtime only; trial status, callbacks, sender verification and owner authorization required |
| Jarvis bridge | JARVIS_SYNC_ENABLED, JARVIS_ALLOW_PRODUCTION_SYNC, ingress controls | Disabled by default; separate tokens and policy checks required |
| MCP | MCP_AUTH_TOKEN, MCP_ALLOWED_HOSTS | Use a high-entropy token (at least 32 characters in production) and strict host allowlists |

Other modules may use additional variables. Search the relevant service code and deployment manifest before configuring them. Do not assume the example file is a complete inventory of every environment variable.

Never commit `.env`, `.env.*` local overrides, database URLs, private keys, access tokens, or provider credentials. `.env.example` is the tracked placeholder template; keep its values blank or non-secret. Keep TLS verification enabled.

## Database setup and migrations

### Local Supabase

The repository includes supabase/config.toml for local development. With the Supabase CLI installed:

~~~bash
supabase start
supabase db reset --local
~~~

That command applies the Supabase-owned migration history to the local Supabase database. It does not apply Prisma application migrations.

### Prisma application schema

For a complete fresh local database, follow the exact two-stage sequence in [supabase/README.md](supabase/README.md). It first applies Supabase migrations, records the committed no-op platform-baseline marker in the Prisma migration ledger, then applies Prisma application migrations.

Useful scripts:

~~~bash
npm run db:generate
npm run db:migration:audit
npm run db:audiobook:status
~~~

The db:migrate, db:setup, db:push, and audiobook migration commands can change database state. Run only against a disposable local or explicitly approved staging target. Do not point local setup commands at production.

### Production boundary

Production migrations are a separate controlled operation. They require an exact reviewed commit, successful required CI/security evidence, a verified target environment, a backup/rollback plan, staging validation, and separate explicit approval. A successful local migration test does not authorize a production migration.

## Testing and validation

Run the narrowest relevant checks first, then the repository validation suite where practical.

~~~bash
npm run typecheck
npm run lint
npm test
npm run test:platform
npm run test:integration
npm run test:e2e
npm run mcp:check
npm run mcp:health
npm run test:quant-engine
npm run validate
~~~

Some scripts depend on local services, generated clients, optional toolchains, or environment variables. Inspect script definitions and prerequisites before running them.

The root validate script is a broad gate covering governance contracts, workflow checks, type checks, lint, unit tests, repository inventory, migration audits, deployment/stack validation, builds, and communications orchestration tests. It may take substantially longer than a focused test.

Report results accurately:

- **Passed:** command completed successfully and produced evidence.
- **Failed:** command ran and failed.
- **Blocked:** a required dependency, credential, provider, or permission prevented execution.
- **Skipped:** the check did not run.
- **Queued:** execution has not completed.
- **Unknown:** evidence is missing, stale, or inconclusive.

A skipped, queued, or configured check is never a pass.

## Containers and deployment configuration

### Docker Compose

The Compose stack defines local PostgreSQL/pgvector, Redis, API, MCP, and an opt-in one-shot migration profile. It expects a local .env file with required development variables.

~~~bash
docker compose up --build --detach --wait
docker compose ps
docker compose logs -f
~~~

Check API health:

~~~bash
docker compose exec -T api wget -q -O - http://127.0.0.1:3000/health
~~~

Stop the stack:

~~~bash
docker compose down
~~~

The migration service is opt-in and targets the local Compose database. Do not run destructive volume-removal commands unless the local data is known to be disposable.

### Render and Railway

- render.yaml describes Render web/API resources and environment groups. It is a proposal/configuration file; applying a Blueprint sync is a separate infrastructure action.
- railway.json configures a Docker build using Dockerfile.api, a /health health check, and restart policy.
- Dockerfile defines API, web, and one-shot migration build targets.
- Dockerfile.api defines a standalone API image.
- docker-compose.yml defines the local multi-service stack.

Before any deployment, verify the live service repository, branch, commit SHA, build/start commands, environment references, health-check result, and deployment workflow. The deployment trigger is commit/workflow based; a local Docker build or image build alone is not evidence of a release.

No deployment, Blueprint sync, production migration, secret change, paid upgrade, or infrastructure mutation is authorized by these README instructions.

## Operational readiness and troubleshooting

### API / database errors

1. Inspect the API's actual health endpoint and service logs.
2. Verify the configured database host, port, TLS mode, and pooler/direct connection type without printing credentials.
3. Check PostgreSQL connectivity independently from Redis.
4. Confirm required Supabase and Prisma migrations exist in the correct environment.
5. Inspect LangGraph/checkpointer initialization separately from base PostgreSQL connectivity.
6. Preserve certificate verification; use the repository's CA configuration rather than disabling TLS checks.
7. Record the exact commit, workflow run, failing step, and provider response.

A Redis PONG does not prove PostgreSQL or LangGraph readiness. An HTTP process responding does not prove that every route or database-backed feature is healthy.

### CI and release

Inspect checks on the exact commit under review. Distinguish passed, failed, queued, skipped, cancelled, missing, and provider-blocked results. Do not merge automatically or treat a successful build as a substitute for security scans, review, or runtime verification.

### Model/provider failures

Verify the server-side endpoint, model identifier, key presence (never its value), provider status, allowlist, timeout, and cost controls. Do not switch models or enable a paid provider as an implicit workaround.

### Communications and devices

A registered integration or paired-device record is not proof of live delivery or device connectivity. Verify the provider callback, owner/destination, device identity, and explicit test authorization before live tests.

## Implementation record — 18–21 November 2026

This section records merged work in the repository history. A merged code change is not, by itself, evidence of a successful deployment, completed database operation, provider connection, or end-to-end production verification.

### Identity, Admin Console, and workspace access

- **PR #183–#185:** added protected user-directory contract coverage and a distinct owner-only authorization guard. Owner-level operations require the verified owner identity; ordinary administrator status is not sufficient.
- **PR #188 and #193:** introduced owner-confirmed account lifecycle requests and transactional replay protection for role changes, suspension, and session revocation. Owner elevation is prohibited.
- **PR #203, #205–#206, #208–#209, #220–#221, and #231:** added SHA-256 canonical event hashing and hash-linked lifecycle audit verification; serialized confirmation; rejected replay and tampered/incomplete audit history; repaired audit payload typing, migration bootstrap, and related regression tests.
- **PR #251:** replaced inert Admin Console tiles with navigation to existing workspaces and read-only runtime diagnostics. Failed refreshes preserve last-known snapshots but mark them stale/unavailable instead of presenting misleading empty or zero values.
- **PR #253:** disables approval controls when the latest approval-queue refresh fails, preventing decisions against stale queue data.
- **PR #250:** restores navigation visibility for registered non-privileged workspaces while preserving administrator-only Admin Console access and owner-only Comms access.

### Gen-X policy, event intake, and agent processing

- **PR #190–#191, #198–#199, and #204:** restored and normalized Gen-X protections for credentials, sensitive targets, and command-control/injection attempts.
- **PR #207:** exposes Gen-X policy regression tests as a distinct CI step.
- **PR #186–#197:** added signed provider-neutral event ingestion, a durable event inbox, and a supervised worker with a server-owned handler registry, bounded polling, graceful shutdown, error backoff, and lease-aware processing.
- **PR #200, #216, #218, and #228:** repaired event-worker control flow and agent/API regression failures while retaining security assertions.

### Database ownership, schema validation, and migration workflow

- **PR #210–#212, #217, #222–#223, and #226:** bootstrapped the Jarvis audit ledger in the Supabase migration chain and strengthened read-only schema audits for event-attempt columns, PostgreSQL types, checks, indexes, foreign keys, and referential actions.
- **PR #213, #224–#225, and #230:** made local Supabase service ports collision-safe and used dynamically allocated ports for the primary and Prisma shadow databases in CI.
- **PR #214–#215, #219, #221, and #232:** repaired cross-schema Supabase Auth/Prisma drift, CI SQL delimiters, and Supabase CLI v3 command compatibility.
- **PR #227:** aligned the LangGraph PostgreSQL pool with the validated Supabase Session Pooler resolver and retained strict TLS/CA parameters.
- **PR #229:** distinguishes PostgreSQL connectivity failures from missing application-schema readiness; it does not run migrations automatically.
- **PR #254:** fails closed when the project-qualified Supabase pooler username does not match the project identity derived from the configured Supabase URL.
- **PR #258:** adds an idempotent profile backfill from existing Auth users and pins the immutable Jarvis audit function search path. Shared-room policies were not restored where their exact prior expressions were unavailable.
- **PR #268–#272:** adds a hard-pinned, one-shot Render staging-only migration runner, target validation, transaction/advisory-lock and rollback safeguards, a manual dispatch requiring explicit confirmation, and pull-request validation that does not mutate a database.
- **PR #275:** requires PostgreSQL TLS with trusted certificate verification for the staging migration runner. Disabling certificate verification is not an accepted workaround.

### Hosting, MCP, CORS, and isolation

- **PR #234–#243:** declares a dedicated U2EB Render MCP service, aligns API/MCP host and health wiring, fixes duplicate Blueprint YAML keys, and corrects the four-resource U2EB deployment contract.
- **PR #245–#248:** adds explicit verified frontend CORS origins and regression coverage for authenticated preflight requests. Wildcard/reflected-origin access is not introduced.
- **PR #236:** blocks Railway staging deployment when the inspected staging environment shares a service and PostgreSQL volume with production. A separate isolated staging target must be provisioned and verified before the workflow can proceed.
- **PR #256:** records the U2EB API/web/MCP/Redis service topology and separates API-only, MCP-only, and browser-safe environment ownership.
- **PR #257:** cleans the manual provider-verification workflow without performing provider calls or consuming inference credits.
- **PR #279:** aligns readiness contracts with a read-only CI audit, a separate manual repair workflow, staging-only Render deployment, and explicit production release/migration inputs.

### Communications and attachment security

- **PR #233:** preserves Twilio webhook signature and owner-sender checks while suppressing automatic inbound WhatsApp replies unless the separate test-authorization gate is exactly enabled.
- **PR #249:** keeps the owner-scoped Comms workspace, status, and history available when outbound communications are disabled; the send endpoint remains explicitly gated.
- **PR #250:** preserves owner-only access and server-side destination verification, action approval, idempotency, webhook-signature, and malware-scanning enforcement.
- **PR #255:** derives owner status from verified Supabase Auth app metadata, with the configured owner-email fallback; client-editable user metadata is not trusted.
- **PR #273:** gates the attachment UI using the authenticated Comms status while retaining server-side private-storage, scanner, and clean-file enforcement.
- **PR #276:** repairs launcher test mocks and preserves file selection when attachment storage/scanner configuration is absent. The API upload and dispatch checks remain authoritative.
- **PR #281:** makes Comms loading, failed-history, retry, empty-history, and server-disabled states explicit. The UI disables outbound dispatch when the server says communications are disabled.
- **PR #282:** aligns Comms test fixtures with the server status contract's required enabled boolean; it is a test-fixture update, not a new runtime feature.

### LangGraph and NVIDIA Aerial

- **PR #260:** adds the RyanAI-side NVIDIA Aerial client, authenticated health/status/inference routes, a dependency-free development bridge, smoke test, and dedicated CI contract job.
- **PR #261–#262:** adds the versioned LangGraph checkpoint schema and development Aerial simulator behavior, then ensures an explicitly configured external Aerial runtime takes precedence over the simulator.
- **PR #263 and #265–#267:** adds an owner-guarded LangGraph package initialization endpoint and a phone-accessible owner control. Follow-up repairs distinguish checkpoint table presence from package migration-ledger completion and retain accurate schema status if ledger verification fails.
- **PR #269–#270:** restores the benchmark-isolation CI contract and explicitly tests accepted network-isolation DNS outcomes.

### 19 November validation repairs

- **PR #274:** removes an unused JWT-secret export from the disposable local Supabase CI step; no credential was created or changed.
- **PR #277–#278:** repairs TypeScript/workflow command compatibility, Comms orchestration test import paths, and adds a read-only repository-inventory contract test.
- **PR #280:** merges the validation-alignment follow-up.
- **PR #281–#282:** completes the latest Comms server-state UI contract and its corresponding test-fixture alignment.
- **PR #283:** converts the Render staging-migration test to Vitest so the repository test runner discovers it, and adds the PostgreSQL pool event-listener mock required by the checkpointer import in launcher tests.

Use the [repository pull-request history](https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main/pulls?q=is%3Apr+is%3Amerged+created%3A2026-11-18..2026-11-19) to inspect exact diffs, reviews, checks, and timestamps. This summary does not replace exact-head evidence.

### 20–21 November 2026 — resilience, recovery, durable events, and realtime

The latest mainline work materially extends the operational control plane and realtime architecture. These changes are implementation work, not proof of production deployment or end-to-end operational readiness.

- **PR #517:** adds the Admin backup/recovery control plane, including owner-gated backup execution, read-only backup inventory and retention preview, isolated recovery-target validation, audit coverage, and an owner-only self-patch panel. Backup execution remains explicitly owner-gated.
- **PR #520:** isolates Comms replay cursors per channel so one channel cannot advance another channel's replay position.
- **PR #521–#525:** repairs and consolidates the Admin resilience/maintenance lifecycle, including owner-authorized audited maintenance requests, lifecycle state, route registration, and resilience-panel behavior.
- **PR #524 and #526:** add the durable audience-scoped event store required for persist-before-publish and channel/audience-aware replay.
- **PR #527:** bridges authenticated WebSocket replay to durable events, including replay ordering, bigint cursor precision, live-event buffering during replay, failure release, bounded backlog, and regression coverage.
- **PR #528:** repairs the Admin Resilience TypeScript build by explicitly typing Prisma JSON resilience details and backup-manifest parsing.
- **Current engineering direction:** backup inventory parsing/failure handling and recovery-target comparison receive focused service-level regression coverage before the next review request. Targeted tests and API typecheck must be evaluated against the exact resulting commit.

These changes advance RyanAI's resilience, recovery, realtime, and administrative-control capabilities, but they do not by themselves establish that backups have been executed, a recovery has been performed, PostgreSQL has been restored, live WebSocket clients are healthy, or production services are ready.

## Current readiness notes — 21 November 2026

The current mainline contains substantial additional resilience, recovery, maintenance, and realtime implementation compared with the 19 November baseline. The following limitations remain important when interpreting repository state:

- **Current main SHA:** `eb7171b88ba47513b20c6a84577c61db62add6c1` (`fix(admin): restore Admin Resilience TypeScript build (#528)`). This is the exact head used for this README update.
- **CI evidence:** the GitHub combined-status endpoint currently returns no status entries for this exact head. Therefore the README does **not** claim that CI/security checks are green. Re-check the exact commit's workflow runs and individual job conclusions before merge or release. Unknown, queued, skipped, cancelled, missing, or provider-blocked evidence is not a pass.
- **Frontend/backend stabilization:** the immediate engineering priority remains stabilizing the existing frontend and backend builds before jumping to unrelated product work. A successful source merge or isolated build is not proof of end-to-end runtime readiness.
- **Database readiness:** PostgreSQL connectivity, migration ownership/order, LangGraph checkpoint readiness, and application database health must be verified independently. Redis connectivity alone does not establish database or checkpointer readiness.
- **Resilience and recovery:** the Admin control plane now contains owner-gated backup/recovery capabilities and read-only inventory/recovery validation. These features must not be described as a completed disaster-recovery exercise until an authorized backup, isolated restore/validation, integrity verification, and evidence receipt have actually completed.
- **Self-patching and maintenance:** self-patch proposals and maintenance lifecycle controls are owner-authorized and audited. They do not grant an agent autonomous authority to modify production infrastructure, secrets, databases, or deployments.
- **Realtime:** durable audience-scoped events and authenticated replay are implemented in mainline. Production readiness still requires runtime verification of persistence, replay ordering, reconnect behavior, channel isolation, failure handling, and operational observability.
- **Communications:** Comms can remain available with outbound dispatch disabled. Provider credentials, callback verification, owner/destination verification, explicit test authorization, approval, and delivery callbacks remain separate gates.
- **Deployment:** Render and Railway configuration remain repository contracts. No README statement authorizes a deployment, Blueprint sync, production migration, infrastructure mutation, secret change, paid upgrade, or live external communication.
- **Vercel:** Vercel is not part of the current RyanAI hosting architecture described by this README.
- **Governance:** focused repair PRs may proceed only as scoped branches with required CI/security evidence and human review. Do not enable automatic merge or bypass required checks.

The following limitations are important when interpreting repository state:

- **Mainline CI:** the current main snapshot is `ff0e33b8792c6d851d039c1e01b224a3e4fd8903` (PR #283). At the last inspection of that exact PR head (`9853036f75b04990b4000b1e31b63b806c711b82`), CodeQL, TruffleHog, SBOM, Security Scan, Container Security, AI Inspector, and the disposable Prisma/pgvector upgrade test reported success; CI build/test, Agent API regression, Docker image build, and Codacy were still in progress; Docker validation, Database Schema Validation, Human PR Approval Gate, and the guarded staging migration workflow reported failure. These are distinct outcomes; the migration dispatch failure is not evidence that a migration ran successfully. Re-check the live exact-head results before reporting current status. Queued, skipped, cancelled, missing, or provider-blocked is not passed.
- **Render build capacity:** PR #282 recorded Render builds blocked by exhausted workspace build-pipeline minutes. Source merges are not evidence of a deployment. Do not purchase an upgrade without separate authorization.
- **MCP runtime:** the U2EB service is declared in the Blueprint, but PR #234 recorded that the required delegation signing secret and service token were absent or too short in the inspected live service. Verify the existing secret references privately, then test MCP health, authenticated tool discovery, and API delegation. Never put credential values in documentation.
- **Communications:** the Comms workspace and owner-scoped history can remain available with outbound dispatch disabled. Provider credentials, webhook callbacks, signature validation, verified owner destination, explicit test authorization, approval, and delivery callbacks remain separate gates.
- **Attachments:** file selection in the UI is not upload readiness. The API requires private storage and malware-scanner configuration; clean-file checks control download/dispatch paths.
- **LangGraph:** checkpoint table existence is not package initialization. Verify the package migration ledger (version 5 or later in the current setup contract) and readiness separately. The owner-only setup route requires deliberate owner invocation; it does not run on API startup.
- **Render staging migrations:** the runner is manual, staging-only, target-pinned, TLS-verified, and requires explicit confirmation. Pull-request validation does not apply the migration. Production remains a separate approval path.
- **Railway staging:** the workflow must reject the inspected shared production service/storage target until a separate isolated staging project is established and verified.
- **NVIDIA Aerial:** the development bridge validates RyanAI's API contract only. It does not prove NVIDIA GPU, NIC, CUDA, real-time kernel, or production Aerial runtime readiness.
- **Hybrid OS:** Ubuntu Core, Kali Security, Raspberry Pi Edge, network segmentation, and recovery are documented architecture/validation targets; do not describe the OS rollout or hardware procurement as deployed.
- **Agent workforce:** the 12-module roster is an ownership/capability registry, not proof of twelve always-on agents. Availability, queue connectivity, assignment, and completed work require separate runtime evidence.
- **Studio:** the current execution adapter remains Jarvis-backed and reports that it is not an independent Studio runtime.

## Complete supporting-document index

This index links the repository's main engineering, architecture, security, product, and operations documents. Supporting files remain the authoritative detail; update them in their own focused change when their implementation contract changes.

### Governance and repository policy

- [Agent and contributor engineering contract](AGENTS.md)
- [Security reporting and deployment policy](SECURITY.md)
- [Agent governance policy](governance/agent-governance-policy.json)
- [Model governance policy](governance/model-governance.yaml)
- [License](LICENSE)

### Architecture and operating model

- [Architecture and governance reference](docs/ARCHITECTURE.md)
- [Canonical topology and deployment contract](docs/architecture/RYANAI_CANONICAL_TOPOLOGY.md)
- [Mission-centric operating architecture](docs/architecture/mission-centric-operating-architecture.md)
- [API control-plane contract](docs/architecture/API_CONTROL_PLANE_CONTRACT.md)
- [Agent governance engine](docs/architecture/AGENT_GOVERNANCE_ENGINE.md)
- [12-module agent workforce](docs/architecture/RYANAI-12-MODULE-AGENT-WORKFORCE.md)
- [Jarvis internal control plane](docs/architecture/internal-jarvis-control-plane.md)
- [Jarvis governance and staged access](docs/architecture/jarvis-governance-and-staged-access.md)
- [MCP delegated runtime](docs/architecture/MCP_DELEGATED_RUNTIME.md)
- [Specialist adapter contract](docs/architecture/SPECIALIST-ADAPTER-CONTRACT.md)
- [Governed provider gateway contract](docs/architecture/GOVERNED_PROVIDER_GATEWAY_CONTRACT.md)
- [RIIP model registry](docs/architecture/RIIP-MODEL-REGISTRY.md)
- [RIIP universal model governance](docs/architecture/RIIP-UNIVERSAL-MODEL-GOVERNANCE.md)
- [Specialist model fit and adoption](docs/architecture/SPECIALIST_MODEL_FIT_AND_ADOPTION.md)
- [Benchmark operational readiness](docs/architecture/BENCHMARK-OPERATIONAL-READINESS.md)
- [Benchmark executable checks](docs/architecture/BENCHMARK-GATE-EXECUTABLE-CHECKS.md)
- [Offline benchmark harness proposal](docs/architecture/OFFLINE-BENCHMARK-HARNESS-IMPLEMENTATION-PROPOSAL.md)
- [Model-independent multimodal security](docs/architecture/MODEL_INDEPENDENT_MULTIMODAL_SECURITY.md)
- [Ghostunnel mTLS foundation](docs/architecture/GHOSTUNNEL-MTLS-FOUNDATION.md)
- [OpenTelemetry agent observability design](docs/architecture/RYANAI-OPENTELEMETRY-AGENT-OBSERVABILITY-DESIGN.md)
- [Studio worker readiness architecture](docs/architecture/STUDIO_WORKER_READINESS.md)
- [Topology integration backlog](docs/architecture/TOPOLOGY_INTEGRATION_BACKLOG.md)
- [RyanAI UI implementation](docs/architecture/RYANAI-UI-IMPLEMENTATION.md)
- [AIOA implementation](docs/architecture/RYANAI_AIOA_IMPLEMENTATION.md)
- [Ubuntu Core Phase 1 audit](docs/architecture/ubuntu-core-phase1-audit.md)

### Security, identity, and privacy

- [Hybrid OS security architecture](docs/security/hybrid-os-security.md)
- [Gen-X security hardening](docs/GENX_HARDCORE_SECURITY.md)
- [Security Centre data contract](docs/SECURITY_CENTRE_DATA_CONTRACT.md)
- [Security cleanup runbook](docs/SECURITY_CLEANUP.md)
- [Static security audit](docs/PR-1345-static-security-audit.md)
- [Private attachment storage](docs/SECURE_ATTACHMENT_STORAGE.md)
- [Attachment malware scanning](docs/ATTACHMENT_MALWARE_SCANNING.md)
- [Attachment message-path guard](docs/ATTACHMENT_MESSAGE_PATH_GUARD.md)
- [Attachment quarantine retention](docs/ATTACHMENT_QUARANTINE_RETENTION.md)
- [Attachment orphan cleanup](docs/ATTACHMENT_ORPHAN_CLEANUP.md)
- [Supabase Auth completion](docs/auth/supabase-auth-completion.md)
- [Supabase OAuth server integration](docs/SUPABASE_OAUTH_SERVER.md)
- [Supabase login investigation](docs/authentication/2026-11-07-supabase-login-investigation.md)

### Agents, Jarvis, events, and integrations

- [Jarvis integration](docs/JARVIS_INTEGRATION.md)
- [AI Inspector audit agent](docs/AI_INSPECTOR_AUDIT_AGENT.md)
- [Agent evaluation and incremental migration](docs/agent-evaluation-and-incremental-migration.md)
- [Durable queue execution planner](docs/durable-queue-execution-planner.md)
- [Targeted execution reliability](docs/targeted-execution-reliability.md)
- [AI engineering tools registry](docs/ai-engineering-tools-registry.md)
- [GenAI code engineering adapter](docs/GENAICODE_ENGINEERING_ADAPTER.md)
- [Plugin integrations centre](docs/PLUGIN_INTEGRATIONS_CENTRE.md)
- [Cloudflare MCP integration](docs/CLOUDFLARE_MCP_INTEGRATION.md)
- [Microsoft Agent Framework evaluation](docs/engineering/MICROSOFT_AGENT_FRAMEWORK_EVALUATION.md)
- [Agent run runtime recovery](docs/operations/agent-runs-runtime-recovery.md)
- [Agent run runtime schema review](docs/operations/agent-runs-runtime-schema-review.md)

### Communications, voice, and messaging

- [Communications Gateway](docs/communications-gateway.md)
- [Owner communications production setup](docs/owner-communications-production-setup.md)
- [Twil8B evaluation](docs/TWIL8B_EVALUATION.md)
- [React Native Agent Console](docs/REACT_NATIVE_AGENT_CONSOLE.md)
- [RyanAI audio intelligence architecture](docs/ryanai-audio-intelligence-architecture.md)

### Workspace and product documentation

- [Studio README and lifecycle](docs/studio/README.md)
- [Studio product blueprint](docs/studio/PRODUCT_BLUEPRINT.md)
- [Studio native core](docs/studio/NATIVE_CORE.md)
- [Studio worker service](docs/studio/WORKER_SERVICE.md)
- [Studio independent worker runtime](docs/studio/INDEPENDENT_WORKER_RUNTIME.md)
- [Studio inference performance evidence](docs/studio/INFERENCE_PERFORMANCE_EVIDENCE.md)
- [PhoneLink documentation](docs/phonelink/README.md)
- [Audiobook render worker](docs/AUDIOBOOK_RENDER_WORKER.md)
- [Quant market data contract](docs/QUANT_MARKET_DATA.md)
- [Quant trading research and FX architecture](docs/architecture/RYANAI_QUANT_TRADING_RESEARCH_AND_FX.md)
- [NVIDIA Aerial AI-RAN integration](docs/aerial-ai-ran.md)
- [South African government procurement agent](docs/ZA_GOVERNMENT_PROCUREMENT_AGENT.md)
- [Research documentation index](docs/research/README.md)
- [LLM foundations learning and evaluation](docs/research/LLM-FOUNDATIONS-LEARNING-AND-EVALUATION.md)

### Hybrid OS, hardware, and recovery

- [Hybrid OS v1 architecture](docs/hybrid-os-v1.md)
- [Ubuntu Core Phase 1 repository audit](docs/architecture/ubuntu-core-phase1-audit.md)
- [Raspberry Pi edge platform](docs/hardware/ryanai-edge.md)
- [Recovery and integrity layer](docs/recovery/ryanai-recovery.md)
- [Hybrid OS implementation validation matrix](docs/implementation/hybrid-os-v1-validation.md)

### Database, hosting, and operations

- [Supabase migration ownership and local setup](supabase/README.md)
- [Database migration ownership and reproducibility](docs/operations/DATABASE_MIGRATION_OWNERSHIP_AND_REPRODUCIBILITY.md)
- [Database migration reconciliation](docs/operations/DATABASE_MIGRATION_RECONCILIATION_2026-11-08.md)
- [Supabase U2EB migration runbook](docs/operations/supabase-u2eb-migration-runbook.md)
- [Supabase PostgreSQL TLS trust](docs/operations/supabase-postgres-tls.md)
- [Production migrations runbook](docs/operations/production-migrations.md)
- [Shared Render/Railway environment variables](docs/operations/SHARED_ENV_VARIABLES_RENDER_RAILWAY.md)
- [Render environment alignment](docs/operations/render-environment-alignment.md)
- [Render and governance reconciliation plan](docs/operations/render-and-governance-reconciliation-plan.md)
- [Render primary / Railway backup deployment plan](docs/operations/render-primary-railway-backup-deployment-plan.md)
- [Main protection and Render recovery](docs/operations/main-protection-and-render-recovery.md)
- [Staging Render runtime verification](docs/ops/render-staging-runtime-verification.md)
- [Database branching and CI](docs/database-branching-cicd.md)
- [Database runbook DB-001](docs/RUNBOOK-DB-001.md)
- [Deployment and quota runbook](docs/DEPLOYMENT_AND_QUOTA_RUNBOOK.md)
- [Governed production release](docs/governed-production-release.md)
- [Startup backups](docs/startup-backups.md)
- [PagerDuty maintenance windows](docs/pagerduty-maintenance-windows.md)

### Engineering evidence, designs, and release history

- [Engineering evidence workbench](docs/engineering-evidence-workbench.md)
- [Engineering intelligence observability baseline](docs/engineering/ENGINEERING_INTELLIGENCE_OBSERVABILITY_BASELINE_2026-11-08.md)
- [OpenTelemetry instrumentation lifecycle audit](docs/engineering/OPENTELEMETRY_INSTRUMENTATION_LIFECYCLE_AUDIT_2026-11-08.md)
- [Copilot review provenance and telemetry contracts](docs/engineering/COPILOT_REVIEW_PROVENANCE_AND_TELEMETRY_CONTRACTS_2026-11-08.md)
- [Engineering design assurance](docs/engineering/EGM_DESIGN_ASSURANCE.md)
- [Worker workforce benchmark v1.5](docs/engineering/WORKER-WORKFORCE-BENCHMARK-V1.5.md)
- [Verified telemetry snapshot integration](docs/engineering/VERIFIED_TELEMETRY_SNAPSHOT_INTEGRATION_2026-11-08.md)
- [Repository inventory snapshot](docs/engineering/repository-inventory-2026-11-05.json)
- [Release readiness — 30 October](docs/RELEASE_READINESS_2026-10-30.md)
- [Release readiness after PR 460](docs/RELEASE_READINESS_POST_460_2026-10-30.md)
- [Deep audit findings and release gates](docs/DEEP_AUDIT_FINDINGS_AND_RELEASE_GATES.md)
- [Beta vision and release gates](docs/BETA_VISION_AND_RELEASE_GATES.md)
- [Darkside completion and operational milestones](docs/DARKSIDE_COMPLETION_AND_OPERATIONAL_MILESTONES.md)
- [Root configuration and deployment audit](docs/ROOT_CONFIG_DEPLOYMENT_AUDIT.md)
- [Issue 435 acceptance evidence](docs/ISSUE_435_ACCEPTANCE_EVIDENCE.md)
- [Issue 435 staging execution runbook](docs/ISSUE_435_STAGING_EXECUTION_RUNBOOK.md)
- [Database schema reconciliation design](docs/designs/DATABASE_SCHEMA_RECONCILIATION_DRAFT.md)
- [Designs index](docs/designs/README.md)
- [CI reliability design draft](docs/designs/ci-reliability/design_draft.md)
- [Community survey design draft](docs/designs/community-survey/design_draft.md)
- [Database schema reconciliation design draft](docs/designs/database-schema-reconciliation/design_draft.md)
- [GitHub governance design draft](docs/designs/github-governance/design_draft.md)
- [Database/CI/security branch-protection verification](docs/verification/2026-11-04-database-ci-security-branch-protection.md)
- [Copilot VS Code session handoff](docs/COPILOT_VSCODE_SESSION_HANDOFF.md)

Workflow definitions and automated checks are maintained in [GitHub Actions workflows](.github/workflows/). Security/quality workflow definitions include CI, CodeQL, dependency review, container security, secret scanning, SBOM, API security, Codacy, benchmark isolation, database migration validation, and separately gated staging/production release workflows. Their presence does not prove a check passed on the current commit; inspect the exact workflow run and job result.

## Repository map

| Path | Responsibility |
| --- | --- |
| src/ | Main application, UI, API routes, agents, services, and integrations |
| src/server/ | API server, route handlers, orchestration, and runtime services |
| src/agent/ | Agent coordination, tasks, and reasoning components |
| src/components/, src/pages/ | React interface and workspaces |
| prisma/ | Application Prisma schema and migrations |
| supabase/ | Local Supabase configuration and Supabase-owned migrations |
| mcp-server/ | MCP service and its independent package |
| workflows-ryanai/ | Workflow service package |
| quant-engine/ | Dependency-free Python research engine |
| android/phonelink/, apps/mobile/ | Mobile and PhoneLink components |
| src-tauri/ | Desktop application/native shell |
| docs/ | Architecture, operations, design, and product documentation |
| .github/workflows/ | CI, security, validation, and controlled deployment workflows |
| Dockerfile*, docker-compose.yml | Container build and local orchestration |
| render.yaml, railway.json | Hosting configuration contracts |

## Contribution workflow

1. Confirm the intended repository, base branch, and exact starting commit.
2. Read AGENTS.md and the relevant module documentation.
3. Create a focused feature or repair branch; do not work directly on main.
4. Reproduce the issue and define acceptance criteria before changing behavior.
5. Add or update regression tests for meaningful behavior.
6. Keep changes scoped. Separate application code, migrations, secrets, infrastructure, and deployment work.
7. Run relevant tests and security checks; preserve exact command output and commit SHA.
8. Open a pull request with scope, evidence, risks, and rollback notes.
9. Require human review and all required checks. Do not enable auto-merge.
10. Merge or deploy only through the separately authorized governance process.

## Security reporting

Do not publish exploitable vulnerabilities, credentials, customer data, or destructive proof-of-concept payloads in public issues. Use GitHub private vulnerability reporting for this repository where available. See [SECURITY.md](SECURITY.md) for the full policy.

## License

See [LICENSE](LICENSE). Check the license terms before redistributing or incorporating this project into another product.

