# RyanAI Plugin & Integrations Centre

## Purpose

The Settings page exposes a discoverable catalogue of integrations relevant to the PA Agent, workforce, workflows, Agentic Communications, knowledge retrieval, engineering and research.

## Current implementation boundary

The first UI increment stores only user-owned preferences in Supabase Auth metadata under `ryanai_plugin_preferences`. It does not install an integration, create a provider connection, store credentials, register runtime tools, or grant a worker permission to execute a tool. The UI labels every catalogue entry **Adapter required** to avoid representing a proposed connector as operational.

Provider credentials must remain in the server-side secret/configuration boundary and must never be copied into user metadata or browser storage. User preferences cannot grant roles, OAuth scopes, provider access or execution rights.

## MCP unified registry — 25 November 2026

The backend MCP tool boundary now has one canonical metadata contract at `src/mcp/canonical-tool-registry.json`. It defines tool identity, owner, risk, capability, execution class, approval requirement, audit requirement, timeout, idempotency, production/secret access flags, description and input schema.

MCP implementations consume filtered views of this registry. A runtime may expose fewer tools because a capability is unavailable or disabled, but it must not add tools or widen the canonical capability/approval policy. Registry presence is not proof of adapter readiness, provider authentication, authorization or live health.

The registry is deliberately separate from provider credentials and plugin connections. Provider execution still requires the server-side connection boundary, Gen-X authorization and any required human approval.

## Required integration lifecycle

1. **Discover:** catalogue a provider, its supported capabilities, owner, data classification and adapter status.
2. **Review:** assess terms, security posture, OAuth scopes, webhook verification, data retention and outbound-action risk.
3. **Connect:** perform provider OAuth or credential provisioning through a server-side flow. Never expose refresh tokens or secrets to the browser.
4. **Authorize:** bind the connection to a verified user/workspace and an explicit least-privilege policy. User preference is not authorization.
5. **Register:** expose tools through the governed MCP/tool registry with stable schemas, ownership, risk labels and default-deny enablement.
6. **Test:** contract tests, mocked provider tests, auth/scope tests, tenant-isolation tests, rate-limit/retry tests, audit tests and failure/revocation tests.
7. **Release:** exact-head CI and security checks must pass; require human review. Do not auto-merge.

## Workforce and module scopes

The UI catalogue records intended consumers such as PA Agent, Comms workers, scheduling workers, knowledge workers, engineering workers and the workflow engine. Runtime enforcement must be implemented server-side; client-side toggles are never an enforcement boundary.

## Communications and high-impact actions

Outbound email, WhatsApp, SMS and voice dispatch must retain the existing human-review checkpoint. Drafting and dispatch are separate capabilities. No connector may bypass approval, send a message during a test, or treat a successful draft as a delivered message.

Financial transactions, brokerage actions, production infrastructure changes, production database migrations and secret rotation remain outside this UI increment and require their own explicit approvals.

## Validation plan

- Verify Settings renders the catalogue on mobile and desktop.
- Verify search and category filters.
- Verify owner/admin visibility restrictions.
- Verify preferences are persisted only after matching the authenticated Supabase user ID.
- Verify malformed preference metadata is normalized safely.
- Verify the component never claims a provider is connected or installed.
- Add adapter-level test suites separately for each provider before enabling runtime use.

## Server registry foundation

The server-side registry foundation is introduced in `src/server/plugins/`:

- `pluginRegistry.ts` defines validated provider manifests, capability risk labels, adapter contracts and an in-process registry.
- `pluginCatalog.ts` seeds the provider catalogue used by the API.
- `routes.ts` exposes the authenticated, read-only `GET /api/plugins/registry` endpoint.
- The API authentication hook requires a verified Supabase user for plugin registry routes.

The registry reports only `adapter_required` or `adapter_registered`. It does not report a provider as connected or healthy: those states require a later connection lifecycle and live provider verification. Registered adapter objects remain private to the server process; public catalogue methods expose metadata only.

Adapter implementations receive an opaque server-side `connectionRef`, never raw browser-supplied credentials. This contract does not yet provide an invocation endpoint or execution service. The next increment must add provider connection ownership, OAuth state/PKCE, encrypted token storage, scope validation, revocation and a Gen-X authorization decision before any adapter can execute.

## Initial API contract

`GET /api/plugins/registry` returns a `providers` array containing provider IDs, display names, categories, manifest versions, declared capabilities, capability risk labels, human-approval requirements, data classifications and adapter registration status. The route requires a verified user and never returns tokens, secrets, connection records or executable adapter instances.

## Non-goals for this increment

- No OAuth flows or provider credentials.
- No live provider adapter implementations.
- No workflow dispatch, PA Agent tool execution or outbound communications.
- No database schema change or migration.
- No production deployment or infrastructure change.

## Secure provider authorization foundation

The authorization foundation in `src/server/plugins/providerAuthorization.ts` provides:

- AES-256-GCM credential encryption with random 96-bit nonces, authentication tags and provider/owner-specific additional authenticated data.
- A fail-closed 32-byte hex key parser. No key is generated, stored in repository settings or provisioned by this change.
- Short-lived OAuth transactions with high-entropy state, SHA-256 state hashes, PKCE S256 challenges and encrypted code verifiers.
- HTTPS-only authorization and redirect URL validation.
- Requested/granted scope intersection, provider allowlists and mandatory-scope enforcement.
- Owner/provider binding checks and explicit provider-confirmed revocation state transitions.
- Encryption helpers for access and refresh tokens that bind ciphertext to the provider and owning RyanAI user.

The accompanying Prisma migration and schema models introduce server-only provider connection records, one-use OAuth state records and append-only authorization lifecycle events. Browser roles `anon` and `authenticated` are explicitly revoked from these tables; server access remains subject to authenticated owner checks. The migration is code only and has not been applied to any database.

### Important implementation boundary

This is a security and authorization foundation, not a complete provider execution service. The later OAuth lifecycle routes implement owner-bound connect/callback/refresh/disconnect for Google Calendar and Microsoft 365 Calendar. Those routes exchange and encrypt OAuth tokens, but they do not register executable calendar adapters or perform provider-specific authenticated health probes. A stored OAuth grant must not be described as a healthy provider or an executable capability. GitHub App authorization remains a separate integration.

Never log OAuth codes, raw state, PKCE verifiers, access/refresh tokens, client secrets or encryption keys. Authorization events may contain only redacted lifecycle metadata.

## Provider OAuth lifecycle routes

The next authorization increment adds server-side OAuth lifecycle routes for Google Calendar (read-only) and Microsoft 365 Calendar (read-only):

- `POST /api/plugins/:provider/connect` — requires a verified user, validates provider configuration, creates a ten-minute state/PKCE transaction and returns the provider authorization URL.
- `GET /api/plugins/oauth/:provider/callback` — consumes the one-use state, exchanges the authorization code, validates granted scopes, encrypts tokens and persists an owner-bound connection.
- `GET /api/plugins/connections` — returns only the signed-in owner's safe connection metadata; ciphertext and tokens are excluded.
- `POST /api/plugins/:provider/refresh` — rotates access/refresh credentials using an owner-scoped connection and compare-and-swap update.
- `POST /api/plugins/:provider/disconnect` — purges local ciphertext and records whether remote revocation was confirmed or remains pending.

The supported provider configurations are read only from server environment at runtime:

- Google Calendar: `RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID`, `RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET`, `RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI`.
- Microsoft 365 Calendar: `RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID`, `RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET`, `RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI`.
- Both: `RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters representing 32 bytes), and optionally `RYANAI_APP_URL` for the post-callback Settings redirect.

No secret values are included in source control, and this change does not create, alter or rotate any environment secret. OAuth callback logging is silent at the route level; application logs contain only provider identifiers and redacted event metadata.

Google Calendar is restricted to `calendar.readonly`. Microsoft 365 Calendar is restricted to `Calendars.Read`, `User.Read` and `offline_access`. Write scopes are not requested. Google remote token revocation is attempted; Microsoft does not expose a compatible OAuth token-revocation endpoint in this adapter, so its state remains `revocation_pending` after local credential purge and requires provider-side revocation through the account's security controls.

These routes do not yet constitute broad provider coverage. GitHub retains its separately implemented GitHub App OAuth integration. Other catalogue providers remain adapter-required. No provider is marked connected without a successful callback and verified token response.

### Authoritative provider capability state

The Studio overview reports separate `connectionStatus`, `authenticationStatus`, `healthStatus` and `executionStatus` values. The states have deliberately different meanings:

- `connected` / `oauth_grant_issued`: the owner-bound OAuth callback exchanged a token and stored the encrypted grant. It is not a live API authentication or reachability guarantee.
- `refresh_required`: the access token has expired but an encrypted refresh token is available; an owner-initiated refresh is required.
- `reauthorization_required` / `expiry_unknown` / `revoked`: the stored connection cannot be treated as authenticated and must be refreshed, reauthorized or verified.
- `not_probed`: no provider-specific authenticated health probe has produced evidence for the connection.
- `blocked_adapter_missing`: no compatible server-side adapter is registered for execution.
- `blocked_health_unverified`: a connection and adapter may exist, but provider health has not been verified.
- `ready`: reserved for the combination of a registered adapter, active non-expired owner grant and successful provider-specific health probe. Gen-X policy and capability-specific human approval still apply at invocation time.

The current OAuth connection implementation does not persist provider health probes, so its health state remains `not_probed`. A successful OAuth callback or token refresh alone therefore cannot make a provider usable. The API sets `usable` only when the complete evidence chain is ready; queued, configured, connected, or adapter-registered alone are insufficient.


## Engineering editor and media integrations — 7 November 2026

### Visual Studio Code for the Web

RyanAI Studio exposes a direct, user-initiated handoff to the official vscode.dev GitHub repository workspace and lists the editor in Settings → Plugins. This is a browser-editor integration, not an embedded VS Code server or a replacement for RyanAI's governed coding execution service.

- GitHub sign-in and repository access are handled by GitHub in the VS Code Web browser session.
- RyanAI does not receive or store GitHub tokens from vscode.dev.
- The browser editor supports repository browsing and lightweight editing; it does not provide a terminal, build/debug runtime, or all desktop extensions.
- RyanAI Studio remains the place for owner-bound coding plans, exact plan/diff approval, queued coding work, and evidence review.
- The editor handoff does not grant repository write permissions, merge rights, deployment rights, or worker execution authority.

A true embedded editor session with shared workspace state and full terminal/build/debug support requires a separately hosted, isolated code-server/Codespaces-like runtime, session lifecycle, filesystem boundary, network egress policy, resource quotas, and audit integration. It is not claimed by this change.

### VLC and music provider preferences

Settings → Preferences persists a validated, account-scoped music preference object: default provider (VLC, Spotify or YouTube Music), remember-provider preference, volume, resume preference, and VLC mode (external, embedded, or both). Settings → Plugins lists VLC, Spotify and YouTube Music.

These are discovery and preference foundations only. VLC Android app control requires a native/mobile bridge or an explicitly supported Android intent contract; embedded playback requires a reviewed media adapter/player and owner-scoped media access. Spotify and YouTube Music require their own provider authorization and playback terms review. Until those adapters are implemented and tested, the catalogue must continue to report them as adapter-required; selecting a preference does not claim a provider is connected or playing.

No credentials, OAuth tokens, provider scopes, production database schema, migrations, deployments or infrastructure settings are changed by these additions.


## Integration ecosystem expansion — 24 November 2026

The catalogue now includes discovery entries inspired by the growing agent-plugin ecosystem: Grafana Cloud, Better Stack, Arize AX, incident.io, Cloudflare, SonarQube, Tavily, ClickUp and DocuSign.

These entries are **catalogue metadata only**. They do not imply an installed plugin, provider account, OAuth grant, live health probe, executable adapter, or production connection. Each remains `adapter_required` until its provider-specific implementation passes review and tests.

### Capability and approval boundaries

- Observability integrations begin with read-only metrics, logs, traces, evaluations and incident discovery. Workspace and personal-data classifications remain explicit.
- Cloudflare deployment mutations require a separately approved human action; this catalogue does not grant deployment permissions.
- Incident updates and escalations require human approval. Incident discovery remains read-only.
- SonarQube exposes analysis and quality-gate discovery only; it does not change branch protection or CI policy.
- Tavily is a research connector. Fetch/search inputs remain untrusted and require bounded URL, redirect, response-size and SSRF controls in any future adapter.
- ClickUp task writes require human approval.
- DocuSign envelope sending and signing are outbound/high-impact actions and require explicit human approval bound to the exact document and recipient payload.

The Antigravity Marketplace is a discovery and distribution surface, not a runtime authorization model for RyanAI. RyanAI keeps its own server-side manifest, connection ownership, OAuth scope review, Gen-X authorization, adapter health evidence and execution-time approval. No provider may self-register executable code or inherit permissions from a catalogue entry.

### Required adapter completion sequence

For each provider, complete the following in a separate, provider-scoped change:

1. Verify official provider API documentation, supported OAuth/app installation model, terms, data retention and webhook verification requirements.
2. Define exact read/write scopes and a server-side connection lifecycle; do not request write scopes for read-only use cases.
3. Implement a typed adapter with bounded timeouts, response-size limits, pagination limits, retry/backoff policy, idempotency where mutations exist, and safe error normalization.
4. Resolve credentials only from the server-side encrypted connection vault. Never accept credentials in tool input, user metadata or browser storage.
5. Bind every request to the verified owner/workspace and re-evaluate Gen-X at invocation time. Default-deny on missing identity, policy, connection, adapter or health evidence.
6. Add mocked provider contract tests, auth-negative and cross-owner tests, scope/revocation tests, rate-limit and timeout tests, audit assertions, and failure/recovery tests.
7. Keep outbound, destructive, infrastructure, signature and communication actions disabled until the exact action receives required human approval.
8. Require exact-head CI/security evidence and human review. No auto-merge, deployment, production migration, secret modification or paid resource provisioning is implied.

The current implementation does not add OAuth clients, provider secrets, adapters, database schema, migrations, deployment configuration or runtime connections for these nine entries.
