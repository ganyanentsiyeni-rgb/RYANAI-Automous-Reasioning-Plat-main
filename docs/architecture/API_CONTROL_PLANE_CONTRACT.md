# RyanAI API Control Plane Contract

**Status:** Proposed implementation in PR B; not merged, deployed, or runtime-certified.  
**Updated:** 7 November 2026.

## Purpose

The RyanAI API is the application control plane. It owns authenticated identity derivation, deterministic policy admission, durable memory access, and server-side reasoning-provider selection. MCP is a protocol/gateway plane that consumes narrow API-issued identity and capability context; it is not a second identity, policy, database, or model-provider authority.

## Canonical responsibilities

| Capability | Authority | Contract |
| --- | --- | --- |
| User identity | Supabase Auth, verified by RyanAI API | Only server-verified Supabase user IDs and trusted app metadata become principals |
| Authorization | Gen-X deterministic policy, invoked by API | Deny by default; agent/service claims cannot become human approval |
| Memory | API-owned memory service over Supabase PostgreSQL/pgvector | User scope is always supplied from verified identity/task context |
| Reasoning | API-owned three-brain orchestrator and provider resolver | Canonical roles are NVIDIA, Qwen, Logic; Nemotron/OpenAI-compatible endpoints are implementation details |
| Local inference | Ollama adapter behind an existing reasoning role | Explicit provider selection; no silent cloud fallback |
| MCP identity delegation | API-signed short-lived assertion | Issuer `ryanai-api`, audience `ryanai-mcp`, verified subject, role, narrow scope, expiry and unique token ID |
| Durable tasks | API + PostgreSQL task/lease records | MCP dispatches only approved task types; task state remains in PostgreSQL |

## Identity and delegated MCP context

The API continues to verify the Supabase access token through `auth.getUser(token)`. Client-supplied user IDs, roles, owner flags, tenant IDs, approval flags and model claims are not authoritative.

The new internal endpoint `POST /api/internal/mcp/delegation` requires:
- a separate MCP service credential in `x-ryanai-service-token`;
- a valid Supabase bearer token for the user;
- one or more explicitly allowlisted read-only MCP scopes;
- a successful Gen-X decision for each requested capability;
- the configured `RYANAI_MCP_DELEGATION_SECRET`.

The issued HMAC-SHA256 JWT has a 60-second default lifetime (120-second hard maximum), issuer `ryanai-api`, audience `ryanai-mcp`, verified subject, role, scope list, issue/expiry times and random `jti`. It contains no email or user metadata. The MCP HTTP service validates signature, issuer, audience, expiry, scope and token lifetime before accepting a request. Every tool invocation is then reauthorized by the API through `POST /api/internal/mcp/authorize`, using the separate MCP service credential and the same delegated token; Gen-X is evaluated again at execution time. The diagnostic scopes remain read-only. A separate `reasoning_request` scope permits only a user-requested model invocation through the API-owned provider registry; it is not a generic network, tool, write, or outbound-communications capability. It is short-lived (maximum 120 seconds) and Gen-X is re-evaluated at invocation time. One-time replay protection remains a prerequisite before any future mutating scope is introduced.

Diagnostic scopes: `tool_registry`, `repository_status`, `platform_health`, and `ryanai_stack_manifest`. The separately governed `reasoning_request` scope exposes the MCP `reasoning_route` tool. Memory, shell, filesystem, GitHub write, deployment, communications dispatch and trading scopes are not delegated by this endpoint.

## Gen-X at API boundaries

Trusted API handlers mark `actorType: human` only after Supabase identity verification. Gen-X grants two narrow user-initiated cases:
- `api_user_memory` for the authenticated user's own Memory Vault records;
- `api_reasoning_request` for a direct user request to use the configured approved reasoning-provider route.

The exception is not available to agent or service actors. Generic mutation and network operations continue to require approval; command execution, credential access, sensitive targets and unsafe tool names remain denied. MCP delegation requests are independently evaluated as service tool capabilities.

## Memory persistence boundary

The new `src/server/memory/memoryService.ts` is the single application memory persistence module used by:
- authenticated Memory Vault HTTP routes;
- agent memory tools (`remember_fact`, `recall_memory`, `forget_memory`);
- reasoning memory-context construction.

Every method requires a verified principal ID and scopes Prisma queries by that ID. Agent callers no longer build independent MemoryEntry queries. PostgreSQL remains authoritative; Redis is not used as durable memory. This PR adds no schema change or migration.

## Model role and adapter mapping

| Canonical reasoning role | Current implementation mapping | Optional local adapter |
| --- | --- | --- |
| NVIDIA | Primary brain; Nemotron is a model selection | Ollama when explicitly selected |
| Qwen | Secondary brain | Ollama when explicitly selected |
| Logic | Verification and synthesis brain; OpenAI-compatible model endpoint | Ollama when explicitly selected |

Ollama is a local inference adapter, not a fourth reasoning role. A selected Ollama role requires `OLLAMA_MODEL`; endpoint defaults to loopback `http://127.0.0.1:11434/v1`. Explicit provider selectors are validated; unknown provider names fail closed. Remote HTTP endpoints are rejected; remote provider endpoints must use HTTPS. Cloud credentials are read only by the API process and never from Vite-prefixed variables.

## Transitional gateway safety

The legacy `/api/internal/openai/chat` endpoint accepts only a shared service token and has no delegated user identity or Gen-X request context. PR B disables it unless `RYANAI_OPENAI_GATEWAY_ENABLED=true`. It must remain disabled until PR C replaces the service-token-only contract with API-issued delegated identity and policy reauthorization. The existing API reasoning endpoint is the approved user-facing route.

## Required configuration (names only)

- `RYANAI_MCP_SERVICE_TOKEN`: distinct service-to-service credential, at least 32 characters.
- `RYANAI_MCP_DELEGATION_SECRET`: separate HMAC signing secret, at least 32 characters.
- `PRIMARY_REASONING_PROVIDER`, `SECONDARY_REASONING_PROVIDER`, `LOGIC_REASONING_PROVIDER`: canonical role provider selectors.
- `OLLAMA_URL` / `OLLAMA_BASE_URL` and `OLLAMA_MODEL`: optional local adapter configuration.
- `RYANAI_OPENAI_GATEWAY_ENABLED=false`: safe default during migration.

This PR documents and references environment variable names only. It does not create, modify, expose, rotate or provision any secret.

## Deployment and verification boundaries

- No Render Blueprint change, service creation, deployment, traffic shift or production configuration update.
- No Railway project or service changes.
- No production database migration or schema change.
- No secret provisioning.
- PR C adds the delegated-token verifier to the MCP HTTP transport, tool-scope filtering, and per-invocation API/Gen-X reauthorization. It does not deploy or provision the MCP service.
- Exact-head typecheck, API tests, MCP tests, security scans, Docker build and staging E2E evidence are required before merge or deployment.


## Governed provider invocation milestone

The API-owned `src/agent/providerRegistry.ts` resolves direct OpenAI, DeepSeek, Anthropic, OpenRouter, NVIDIA, Qwen, xAI and Ollama configuration. Provider keys remain server-side. MCP no longer selects provider endpoints or sends provider credentials: `reasoning_route` sends an explicit provider/model request to `POST /api/internal/mcp/reasoning` with the API-issued delegated identity and MCP service credential.

The internal reasoning route verifies both credentials, requires the `reasoning_request` scope, and re-evaluates Gen-X using the trusted `actorType` carried in the API-signed, short-lived delegation assertion. That actor type is derived from Supabase-verified app metadata; the current `api_reasoning_request` policy permits only `human`, so explicit `agent` and `service` actors cannot inherit the human exception. The route enforces the provider model allowlist before invoking the API-owned adapter. The route returns normalized text and token usage where the provider reports it. It does not execute provider tool calls.

Native Anthropic requests use the Messages API contract and a server-held `ANTHROPIC_API_KEY`. OpenAI-compatible direct providers and OpenRouter remain separately identified. A ChatGPT subscription is not an API credential. Provider health, failover, ZAR cost estimation, full multimodal capability and native Anthropic structured-output support remain separate follow-up gates; this invocation route does not certify them.
