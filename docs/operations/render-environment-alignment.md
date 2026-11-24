# RyanAI Render environment alignment contract

## Purpose

This document defines the intended U2EB service topology and the checks required before treating an environment as aligned. It is a source-of-truth contract, not evidence that a live Render service has been changed.

## Canonical U2EB topology

| Responsibility | Canonical resource | Runtime contract |
|---|---|---|
| Application API | `ryanai-api-u2eb` | Render Docker web service; `./Dockerfile.api`; listens on configured `PORT`; health path `/health` |
| Web application | `ryanai-web-u2eb` | Render static site; `npm ci --legacy-peer-deps && npm run build:web`; publishes `./dist`; `VITE_API_BASE_URL` resolves to the API hostname |
| MCP HTTP server | `ryanai-mcp-u2eb` | Render Docker web service; `mcp-server/Dockerfile`; health path `/health`; binds `0.0.0.0:8765` |
| Redis | `ryanai-redis-u2eb` | Render Key Value; API obtains `REDIS_URL` through a service reference |

The current live MCP resource has the Render-generated name `ryanai-mcp-u2eb-u2eb`. Its observed hostname is therefore the deployed alias used by the API's `RYANAI_MCP_HEALTH_URL` and the MCP host allowlist. Do not rename or recreate this resource as part of a Blueprint sync until its resource identity and replacement behavior are confirmed. The intended canonical Blueprint name remains `ryanai-mcp-u2eb`.

## Environment ownership

### API-only server configuration

The API owns server-side values such as:

- Database and cache: `DATABASE_URL`, `REDIS_URL`.
- Supabase server configuration: `SUPABASE_URL`, `SUPABASE_SESSION_POOLER_HOST`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, and any separately required privileged server credential.
- MCP trust: `RYANAI_MCP_DELEGATION_SECRET`, `RYANAI_MCP_SERVICE_TOKEN`, `RYANAI_MCP_HEALTH_URL`.
- Provider credentials and endpoints: NVIDIA, Qwen/DashScope, Grok/xAI, OpenAI, Anthropic, DeepSeek, Together, OpenRouter, SiliconFlow, Logic, Ollama, TorchTPU, and approved private/local gateways.
- Server integrations: GitHub, Twilio, Resend/SMTP, Jarvis, Cloudflare and attachment scanning, when explicitly enabled.

Provider credentials must never use a `VITE_` prefix or be placed in browser-visible build variables.

### MCP-only server configuration

The MCP service owns its HTTP binding and access controls:

- `MCP_HOST`, `MCP_PORT`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`.
- `RYANAI_API_BASE_URL`, `RYANAI_API_HEALTH_URL`.
- `RYANAI_MCP_ENABLED_TOOLS`.
- The same exact `RYANAI_MCP_DELEGATION_SECRET` and `RYANAI_MCP_SERVICE_TOKEN` values as the API, supplied through the private runtime secret manager.

The two MCP credentials are separate credentials with distinct purposes. Both must satisfy the application minimum length and the API/MCP values must match. This document does not generate, store or disclose them.

### Web-only public configuration

The static frontend receives only:

- `VITE_APP_ENV`
- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

No service-role key, database URL, Redis URL, MCP token, model key, GitHub token, Twilio token or SMTP password belongs in the frontend.

## U2EB project mapping

The root `.env.example` intentionally pins the canonical U2EB public project URL and EU Central Session Pooler hostname while leaving `DATABASE_URL` blank. The full `.env.u2eb.example` adds the U2EB API/web origins, Redis placeholder and disabled automation defaults. Both templates contain no database password or privileged key; the ignored local `.env` and sealed Render values are the only places for credentials.

The staging/production API startup contract now verifies that `DATABASE_URL` targets the same project named by `SUPABASE_URL`: either the project's direct `db.<project-ref>.supabase.co` host or a Session Pooler URL with the matching project-qualified username. A Render-managed PostgreSQL hostname or a pooler username for another project is rejected before Prisma or the agent worker starts. This prevents a healthy connection to the wrong database from masking a missing `public.agent_runs` table.

The U2EB Render Blueprint intentionally leaves database and Supabase values as `sync: false`. A Blueprint declaration is not proof that a value is present in the Render dashboard. Verify the saved variable names and presence separately; never infer them from this file.

## Live service drift requiring dashboard reconciliation

The 18 November 2026 Render inventory contained seven resources:

- `ryanai-api-u2eb`
- `ryanai-web-u2eb`
- `ryanai-mcp-u2eb-u2eb`
- `RyanAI_API_Repair`
- `ryanai-web-authfix`
- `RyanAi_API`
- `RyanAI_API2`

Only the first three are candidates for the canonical U2EB application path; Redis is the supporting Key Value resource. The other services must be classified as obsolete, repair-only, or separately owned before any deletion or mutation.

Observed blockers at audit time:

- U2EB API responded but reported database schema readiness, LangGraph checkpointer and worker readiness failures; several authenticated API routes returned HTTP 503.
- MCP startup rejected `RYANAI_MCP_DELEGATION_SECRET` and `RYANAI_MCP_SERVICE_TOKEN` for not meeting its minimum-length validation. A later attempt timed out without an open listening port.
- Repair API exited because `DATABASE_URL` and `REDIS_URL` were missing.
- `RyanAI_API2` was configured as a static site with `Dockerfile.api` as its root directory; its build logs reported that the root directory did not exist.
- `RyanAi_API` had no configured health-check path and an observed start command inconsistent with the API Docker runtime.
- The auth-fix frontend built successfully, but that does not establish that it is the canonical frontend or that its API integration works.

## Provider verification contract

A provider is not healthy merely because a model name, endpoint or secret variable is declared. Each provider needs an independent, sanitized verification result with these stages:

1. Credential presence check without printing or transmitting the credential to logs.
2. Endpoint DNS/TLS/connectivity check.
3. Authentication check.
4. Model entitlement and request-compatibility check.
5. Minimal bounded inference challenge and exact-response validation.
6. Sanitized result persistence and evidence (provider, model, status, latency, timestamp, error category).

Statuses must distinguish `PASS`, `MISSING_CONFIGURATION`, `AUTH_FAILED`, `FORBIDDEN_OR_NO_ENTITLEMENT`, `ENDPOINT_OR_NETWORK_FAILED`, `MODEL_NOT_FOUND`, `RATE_LIMITED`, `PROVIDER_ERROR`, and `NOT_TESTED`. Do not run paid inference without explicit test authorization. The existing manual workflow currently probes the primary, secondary and logic brains; it does not yet establish independent coverage of every provider in the environment contract, including Grok.

## Change-control boundary

This contract does not authorize live Render environment edits, secret creation or rotation, service deletion/renaming, paid upgrades, database migrations, or production deployments. Make source changes through a focused branch and PR; reconcile live values through the Render dashboard only after reviewing the exact proposed changes. Keep the U2EB and production resources isolated.
