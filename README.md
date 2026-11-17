# RyanAI — Autonomous Reasoning Platform

RyanAI is an AI-assisted, human-governed engineering and operations platform. It brings together conversational assistance, agent orchestration, model routing, durable memory, software workspaces, communications, audiobook production, quantitative research, and operational controls behind authenticated APIs and reviewable workflows.

> **Authority principle:** AI proposes. Gen-X authorizes. Jarvis coordinates. Tools execute. Systems report. Evidence proves. Memory remembers. Humans retain approval authority wherever policy requires it.

This README describes the application and contracts present in this repository. It does not claim that every integration is connected, every workflow is passing, or every service is deployed. A source file, configured provider, queued job, green unit test, or healthy process is not by itself proof of end-to-end production readiness.

## Contents

- [Product overview](#product-overview)
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

- **Ubuntu LTS — Core:** the trusted host for RyanAI services, containers, model/agent workloads, memory, APIs, and observability.
- **Kali Linux — Security Zone:** an isolated environment for authorized security assessment and defensive testing. It is not a production runtime dependency and receives no standing production credentials.
- **Raspberry Pi OS 64-bit — Edge:** controlled physical nodes for voice/audio, sensors, GPIO, cameras, local interfaces, and limited edge inference. Each device requires a unique identity and authenticated encrypted gateway connection.
- **Security Fabric:** shared identity, authentication, Gen-X authorization, encrypted transport, audit, and telemetry across trust zones.
- **Recovery Layer:** independently controlled integrity verification, backup restoration, isolation, and rebuild procedures.

The initial trust zones are **CORE**, **SECURITY**, **EDGE**, **MANAGEMENT**, and **RECOVERY**. Inter-zone traffic is default-deny and must be explicitly scoped and authenticated. No agent or model may self-authorize; consequential execution follows capability validation, Gen-X policy, human approval where required, exact-action execution, and an audit/evidence receipt.

Architecture approval is documentation approval only. It does not authorize hardware procurement, production deployment, production database changes, secret changes, infrastructure changes, or paid upgrades. Implementation must proceed through reviewed phases and evidence gates.

Detailed specifications:
- [Hybrid OS v1 architecture](docs/hybrid-os-v1.md)
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

**Trial-expiry action required:** the owner received a Twilio notice for “My First Twilio Account” stating that one week remained in the 30-day trial. The account owner must sign in to the Twilio Console, review the account, billing method, service requirements and any trial restrictions, then decide whether to upgrade before the trial ends. RyanAI does not upgrade accounts or authorize paid spend automatically. Until the owner confirms account status and authorizes any paid change, treat Twilio as trial-limited and potentially interruptible.

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

**Runtime compatibility note:** package.json declares Node.js 24.x, while the checked-in Dockerfiles currently use Node 26 base images. Reconcile and test this mismatch before treating local and container runtime compatibility as certified.

## Local development

### 1. Get the source

~~~bash
git clone https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main.git
cd RYANAI-Automous-Reasioning-Plat-main
~~~

Use the branch and repository approved for your work. The Render Blueprint in this tree currently names the separate RyanAI-Automated/RYANAI-Automous-Reasioning-Plat repository as its service source; verify the intended canonical source before connecting or deploying this working repository.

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

