# RyanAI Governed Provider Gateway Contract

**Status:** Contract and migration baseline. The API-owned provider registry and governed invocation adapter are implemented; the Logic OpenRouter override now shares the adapter after approved-AgentRun/lease authorization. Provider runtime activation, health/failover, full usage/cost, privacy and staging acceptance remain gated.
**Baseline:** `main` at `0a55f4f599cd6454a29eaad44493dbcb5fb52803` (8 November 2026).

## Decision

RyanAI exposes external and local model providers through one API-owned, governed provider gateway. The API is the sole authority for provider selection, credential access, policy admission, request shaping, telemetry, usage attribution, and failover. MCP is a protocol adapter: it authenticates as a service, presents API-issued delegated identity, and calls the API gateway. MCP must not independently select providers, hold provider credentials, or call provider endpoints directly.

The target hosting boundary remains Render for the API and MCP services, with Railway reserved for approved persistent/worker workloads. Vercel AI Gateway is not part of the target architecture and must not be introduced as a runtime dependency.

## Current implementation inventory (main baseline)

| Area | Observed implementation | Gap / disposition |
| --- | --- | --- |
| OpenAI | API has `src/server/routes/internalOpenAi.ts`; it invokes the API-owned model client. MCP `routeOpenAIGateway` calls it with a shared service token. The API route is disabled unless `RYANAI_OPENAI_GATEWAY_ENABLED=true`. | Transitional route is service-token-only and has no delegated user identity or Gen-X request context. Keep disabled; replace with delegated gateway contract before enabling. |
| DeepSeek | `mcp-server/provider-router.js` contains a DeepSeek OpenAI-compatible adapter with a loopback default endpoint and optional remote key. Tests cover local/remote endpoint validation and response parsing. | Direct MCP-to-provider routing bypasses the API-owned provider authority. Move the adapter behind the API registry; MCP must never receive `DEEPSEEK_API_KEY`. |
| Claude | `models/catalog.json` offers `~anthropic/claude-sonnet-latest`; `src/agent/modelSelection.ts` resolves it through the OpenRouter registry entry and the shared API-owned invocation adapter. | This remains an OpenRouter-routed model selection, not a native Anthropic adapter. Preserve it only as an explicitly labelled aggregator route. |
| ChatGPT / GPT | `models/catalog.json` offers `~openai/gpt-latest` through OpenRouter. Existing `gpt-4o` and `gpt-4o-mini` remain on the configured Logic provider. The Logic override resolves through the canonical registry and shared API-owned adapter. | Separate direct OpenAI API integration from OpenRouter. Do not imply that a ChatGPT subscription is an OpenAI API credential or that RyanAI can invoke a user's ChatGPT app session. |
| Vercel AI Gateway | References remain in `src/agent/providerConfig.ts`, its tests, `mcp-server/provider-router.js`, its tests, `.env.example`, and `docker-compose.yml`. | Remove from supported provider selectors, defaults, tests, sample configuration, and deployment manifests in a dedicated code PR. No live configuration or secrets are changed here. |

## Canonical provider registry contract

The registry is API-owned and server-side. Each entry must be explicit and versioned:

- `providerId`: stable canonical ID (for example `openai`, `deepseek`, `anthropic`, `openrouter`, `nvidia`, `qwen`, `xai`, `ollama`).
- `adapter`: a known adapter kind (`openai-compatible`, `anthropic-messages`, or `ollama`); never accept an arbitrary adapter name from a client.
- `endpoint`: server configuration only; HTTPS required for remote endpoints, loopback HTTP allowed only for explicitly local adapters. Reject URL credentials, query strings, and fragments.
- `credentialRef`: server-side secret reference name only; never return a secret or accept a credential value from a request.
- `modelAllowlist`: explicit model IDs permitted for this provider. A client cannot supply an arbitrary endpoint, provider URL, credential, or unapproved model.
- `capabilities`: declared request features (text, structured JSON, streaming, tool calling, vision, audio) that are separately tested. Unsupported features fail closed.
- `status`: configured, unconfigured, healthy, degraded, disabled, or provider-blocked. Configuration alone is not health.
- `limits`: timeout, maximum input/output size, concurrency, retry budget, and per-request cost ceiling.
- `policy`: allowed actor types, scopes, data classifications, and Gen-X policy decision requirements.
- `telemetry`: provider/model ID, request ID, latency, token/usage metadata where returned, normalized error class, and cost estimate/provenance. Never record prompts, private content, credentials, or authorization tokens by default.

Registry entries are configuration, not proof of provider availability. A health check must make a bounded, explicitly authorized probe and record the timestamp and result. Missing credentials are `unconfigured`; skipped probes are not healthy.

## Unified request and response envelope

The API gateway accepts a versioned request containing:

- request/correlation ID (server-generated if absent);
- verified actor and tenant context derived from Supabase Auth or a valid API-issued delegated assertion;
- canonical reasoning role (NVIDIA, Qwen, Logic) or a separately authorized provider task;
- model selection from the server-side allowlist;
- normalized messages/content and requested response format;
- deadline, idempotency key, and bounded generation parameters;
- policy decision reference and permitted capability scope.

The API derives identity and tenant scope; client-supplied owner IDs, roles, approval flags, provider credentials, endpoint URLs, and policy decisions are untrusted and ignored/rejected.

The response returns a normalized result plus request ID, provider ID, model ID, usage metadata when available, latency, and a typed status/error. Provider raw diagnostics and secret-bearing payloads are never returned to clients.

## Provider-specific integration contracts

### OpenAI API and ChatGPT model family

- Use the OpenAI API adapter with a server-held `OPENAI_API_KEY`, an explicit model allowlist, and the official API endpoint unless an approved compatible endpoint is configured.
- "ChatGPT" in the product UI is a model-family/product label only. Calls from RyanAI are API calls billed and authorized under the configured OpenAI API account.
- A ChatGPT subscription does not establish API access, provide an API key, or authorize RyanAI to use the user's ChatGPT session.
- OpenRouter GPT catalogue entries remain identified as `OpenAI via OpenRouter`; they must not be represented as direct OpenAI API calls.

### Claude / Anthropic

- Native Claude integration uses the Anthropic Messages API adapter with a server-held `ANTHROPIC_API_KEY`, explicit Claude model allowlist, versioned Anthropic request headers, and a tested normalized response/error mapping.
- OpenRouter Claude catalogue entries remain a separate `openrouter` route and are labelled `Anthropic via OpenRouter`; they are not native Anthropic API connectivity.
- No credential is provisioned or changed by this contract.

### DeepSeek

- Preserve the existing tested OpenAI-compatible adapter semantics, model allowlist, JSON response validation, timeout, HTTPS/loopback restrictions, and no provider tool-call execution.
- Relocate provider invocation and credential resolution to the API. The MCP adapter calls only the API gateway with delegated identity and a narrow capability scope.
- Local DGX/loopback endpoint configuration is distinct from a hosted DeepSeek API endpoint. No local endpoint is assumed reachable from Render or Railway.

### OpenRouter

- Treat OpenRouter as an independent aggregator provider with its own credential, endpoint, model allowlist, usage/cost attribution and health state.
- Do not disguise OpenRouter routes as direct OpenAI or Anthropic integrations.

## Reasoning roles and authorization

Canonical reasoning roles remain NVIDIA, Qwen, and Logic. Providers and model families are implementations behind those roles, not new authorization authorities or automatic new reasoning roles. Ollama remains an optional local adapter. Provider selection never changes Gen-X authority.

The API must evaluate Gen-X policy before dispatch and re-check policy for any consequential tool capability. MCP service authentication is not delegated user identity. Delegated assertions must be short-lived, audience-bound, scoped, replay-resistant for mutations, and verified on every invocation. Model output cannot grant permission, approve an action, or expand scope.

## Failover, health, usage and cost

- Failover is explicit and policy-bounded: only providers/models pre-approved for the same task/data class may be attempted.
- Never silently move private or restricted data to a different provider, aggregator, geography, or retention regime.
- Retry only classified transient failures, with bounded attempts, deadlines, backoff and idempotency. Do not retry authorization, validation, quota, or policy denials as if transient.
- Preserve the primary failure and record fallback attempts independently. A fallback success must not hide the primary provider failure.
- Report health separately from configuration and distinguish passed, failed, queued, skipped, cancelled, missing, and provider-blocked evidence.
- Attribute input/output tokens where returned, provider-reported usage, price schedule version, currency, and estimated ZAR cost. Mark estimates and missing usage explicitly; do not fabricate costs.
- Provider health probes and benchmarks must be bounded and cost-controlled.

## Required implementation sequence

1. **Inventory and removal PR:** remove Vercel AI Gateway from code selectors, MCP provider catalogue, tests, `.env.example`, Compose and docs. Preserve unrelated Vercel hosting/deployment decisions only as already documented; do not add Vercel runtime dependencies.
2. **API registry PR:** introduce typed provider registry and normalized adapter contracts; migrate OpenAI and DeepSeek invocation into the API; add native Anthropic adapter contract and OpenRouter as a separately identified aggregator. Add tests for configuration, endpoint validation, credential isolation, allowlists, normalized errors and unsupported capabilities.
3. **Delegated MCP PR:** replace the disabled service-token-only OpenAI route with API-issued delegated identity and Gen-X authorization. Reduce MCP reasoning tools to a narrow API gateway client; remove direct provider calls and provider credentials from MCP configuration.
4. **Model selection PR:** map ChatGPT/GPT and Claude catalogue choices to explicitly identified OpenAI API, Anthropic API, or OpenRouter routes. Preserve canonical NVIDIA/Qwen/Logic roles and fail closed on missing credentials or unsupported selections.
5. **Reliability PR:** add provider health, circuit-breaker/failover policy, usage/cost attribution, and staging integration tests across API and MCP.

## Acceptance gates

- Unit tests prove every provider resolves only its own credential and endpoint; no credential crosses providers.
- API tests prove verified actor/tenant derivation, Gen-X allow/deny, model allowlists, request limits, idempotency and no side effects on denial.
- MCP tests prove it cannot call provider endpoints directly, cannot supply provider keys, and cannot bypass API policy.
- Contract tests cover OpenAI-compatible and Anthropic-native request/response/error normalization.
- Tests cover timeout, cancellation, quota, invalid response, provider outage, bounded retries, failover restrictions and cost/usage gaps.
- Exact reviewed commit SHA has completed passing required CI/security checks; queued, skipped, missing, cancelled or provider-blocked checks are not passes.
- Staging integration verifies Render API ↔ MCP service and approved Railway workloads without production traffic.
- Human review is required. No auto-merge.

## Explicit exclusions

This document does not authorize secret provisioning or modification, provider account creation, paid upgrades, production deployment, production database migration, live communications, changes to Gen-X policy, model self-authorization, or infrastructure changes. No provider call is made by this documentation change.


## Implementation update — 8 November 2026

- PR #1322 removed the Vercel AI Gateway provider adapter, selector options, tests and Compose/sample configuration references. Vercel AI Gateway is not a target runtime dependency.
- PR #1323 merged the API-owned typed provider registry for OpenAI, DeepSeek, Anthropic, OpenRouter, NVIDIA, Qwen, xAI and Ollama.
- The follow-on governed invocation PR adds a delegated MCP `reasoning_request` scope, Gen-X reauthorization at issuance and execution, an API-only provider invocation route, native Anthropic Messages handling, and MCP routing that carries no provider keys or provider endpoints.
- This invocation increment does not implement provider health probes, circuit breakers/failover, price-schedule-based ZAR cost calculation, or full multimodal/tool capabilities. Those remain explicit later acceptance gates.
- Runtime configuration on Render/Railway is unchanged. The new service-token and delegation-secret environment wiring must be reviewed and verified in staging before enabling the MCP reasoning tool.


## Implementation update — 26 November 2026

- The Logic model override no longer constructs a direct `ChatOpenAI` client for OpenRouter. It resolves the explicitly catalogued alias through `providerRegistry.ts` and calls the shared API-owned `providerInvocation.ts` adapter.
- The API MCP route and AgentRun worker share endpoint/credential resolution, allowlist enforcement, request shaping, normalized text/usage, and the no-provider-tool-execution boundary.
- Worker dispatch requires a persisted approved AgentRun and a fresh live-lease check, then uses a distinct worker-only Gen-X `approvedAgentRun` signal. It does not reuse the route-only `ownerAuthorized` flag.
- `gpt-4o` and `gpt-4o-mini` remain on the configured Logic provider. OpenRouter runtime activation remains disabled pending remaining catalogue, usage/cost, reliability, privacy/data-region and staging gates.
- Regression tests were added for model selection, shared OpenRouter invocation, allowlist/credential fail-closed behavior, no tool-call execution and Gen-X approved-run authorization. Exact-head CI remains authoritative.



## OpenRouter configuration and release boundary — 26 November 2026

- OpenRouter API key, endpoint, and model allowlist are optional API-runtime configuration; the key is never a browser or MCP credential.
- The Logic worker uses the shared API-owned provider invocation adapter after approved-AgentRun and live-lease revalidation. Provider tool calls are not executed implicitly.
- Runtime activation remains disabled pending model catalogue review, versioned pricing/ZAR attribution, streaming/tool capability contracts, provider health/failover, privacy/data-region review, and staging proof.
- The Render U2EB blueprint declares the key as `sync: false`; this does not create or provision a secret. No live Render/Railway/Vercel settings are changed by the repository declaration.
