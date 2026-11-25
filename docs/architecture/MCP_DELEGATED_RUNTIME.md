# RyanAI delegated MCP runtime topology

**Status:** implementation proposal in PR C; not deployed or runtime-certified.

## Trust boundaries

1. **Identity provider — Supabase Auth.** The API verifies the user's access token with Supabase Auth. Client-supplied subject, role, owner flag and approval claims are not trusted.
2. **Control plane — RyanAI API.** The API issues a short-lived HMAC-SHA256 delegated identity only after the MCP service credential, verified Supabase user, requested read-only scopes and Gen-X policy checks pass.
3. **Protocol plane — MCP HTTP service.** The HTTP transport accepts only an API-issued bearer delegation. It verifies issuer, audience, signature, expiry, lifetime and scope, then intersects the token scopes with the operator-configured MCP allowlist.
4. **Execution authorization — API per tool call.** Before a delegated tool executes, MCP calls `POST /api/internal/mcp/authorize` with the delegated bearer token and its server-held `x-ryanai-service-token`. The API validates the token and scope again and evaluates Gen-X for the requested capability. Denial, timeout, invalid identity or unavailable API fails closed.
5. **Data plane — Supabase PostgreSQL/pgvector.** Application data and durable agent state remain behind the API's shared Prisma client. MCP diagnostics do not receive database credentials or direct SQL access.

## Delegated scope

The only HTTP-delegated scopes are:

- `tool_registry`
- `repository_status`
- `platform_health`
- `ryanai_stack_manifest`

The token lifetime defaults to 60 seconds and cannot exceed 120 seconds. No shell, filesystem write, repository write, database, memory, reasoning-provider, communications dispatch, trading, deployment or infrastructure mutation scope is granted.

The current scope set is read-only. One-time replay protection and a separately reviewed approval reference are required before any future mutating or outbound scope is added.

## Runtime configuration contract

Names only; this change does not create or modify credentials.

- `RYANAI_MCP_DELEGATION_SECRET`: shared HMAC verification/signing secret; at least 32 characters.
- `RYANAI_MCP_SERVICE_TOKEN`: separate MCP-to-API service credential; at least 32 characters.
- `RYANAI_API_BASE_URL`: API origin; HTTPS is required for remote deployments.
- `MCP_HOST`: loopback for development; production defaults to `0.0.0.0`.
- `PORT` or `MCP_PORT`: Render-assigned `PORT` takes precedence.
- `MCP_ALLOWED_HOSTS`: explicit comma-separated MCP service hostnames.
- `MCP_ALLOWED_ORIGINS`: exact browser origins; empty by default.
- `RYANAI_MCP_ENABLED_TOOLS`: operator allowlist, intersected with the delegated user's scope.

Production HTTP startup fails when the API origin, service credential or delegation secret is missing. A deployed host must be explicitly allowlisted. No Render service, environment variable or deployment is changed by this PR.

## STDIO boundary

STDIO is a local process transport, not a remotely exposed HTTP endpoint. It remains a separately managed local-operator boundary. Do not expose the process to untrusted local clients or treat its presence as proof that the delegated HTTP topology is deployed.

## Database invariants

- Supabase PostgreSQL remains authoritative for durable application and task state.
- API routes and Studio workers use the same Prisma client and the same Session Pooler URL resolution.
- Production Supabase connections require verified TLS; no TLS verification bypass is permitted.
- This PR adds no database migration, table, policy, index or production database mutation.
- RLS, grants and policy coverage must be reviewed per table before direct client access is enabled; RLS enabled without a policy is deny-by-default, not proof that application access works.

## Verification required before release

- API TypeScript build and MCP syntax/test suite at the exact PR head.
- API route tests for service authentication, delegated identity, scope mismatch, expiry and per-call Gen-X denial.
- MCP tests for invalid signatures, expiry, scope filtering, API denial and API timeout.
- Exact-head CodeQL, secret scanning, dependency/container scans and SBOM.
- A non-production integration test using an explicitly authorized test identity and read-only diagnostic scope.
- Human review and separate deployment approval.

Queued, skipped, missing or provider-blocked checks are not passing evidence.


## Canonical registry alignment — 25 November 2026

The API-issued MCP delegation scopes are now checked against the canonical registry in `src/mcp/canonical-tool-registry.json` at module load. Each delegated scope must resolve to a canonical tool with the expected capability identifier and required audit metadata. This prevents the API delegation contract from silently drifting away from the MCP tool catalogue. A new or renamed delegated capability must update the canonical registry and its regression tests before it can execute.
