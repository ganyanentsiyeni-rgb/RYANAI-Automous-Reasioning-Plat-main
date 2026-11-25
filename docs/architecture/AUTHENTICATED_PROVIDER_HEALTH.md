# Authenticated Provider Health

Authenticated provider health is a separate evidence layer from OAuth authorization.

## Contract

A provider is not considered healthy merely because:

- OAuth consent completed;
- a token is stored;
- a connection row exists;
- an adapter is registered; or
- the provider appears in the catalogue.

The authenticated health route performs a read-only, provider-specific API probe using the server-resolved access token for the authenticated owner. It never accepts a browser-supplied token and never returns token material.

Supported probes currently cover:

- Google Calendar: authenticated Calendar API calendar-list read.
- Gmail: authenticated Gmail profile read.
- Microsoft 365 Calendar: authenticated Microsoft Graph /me read.

The health evidence is persisted in the existing connectionMetadata.health JSON object, so this increment does not require a schema migration.

## State model

not_probed = no successful provider-specific probe evidence exists.

healthy = the provider accepted the authenticated read-only request.

degraded = the provider returned a transient condition such as rate limiting or a server-side failure.

unavailable = the provider rejected authorization or the probe could not obtain an HTTP response.

Execution remains blocked unless the provider has an adapter, an active owner authorization, and healthy provider evidence. Gen-X authorization and capability-specific human approval remain separate gates.

## Security

- owner-scoped connection lookup;
- server-side token decryption only;
- no token in request input, response, logs, or persisted health evidence;
- HTTPS-only provider endpoints;
- bounded request timeout;
- response bodies are not persisted;
- read-only provider probes only.

Provider health checks are not automatically scheduled in this PR. A future worker/observability stage may add durable polling with explicit rate limits and retention.
