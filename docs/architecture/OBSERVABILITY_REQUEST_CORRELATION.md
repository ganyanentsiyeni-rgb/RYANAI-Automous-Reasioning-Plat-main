# Request Correlation Observability Contract

## Purpose

RyanAI HTTP requests now carry a bounded `X-Request-ID` correlation identifier across the API boundary.

## Contract

- If an upstream `X-Request-ID` is present and matches the transport-safe allowlist, RyanAI preserves it.
- Unsafe, empty, oversized, or malformed IDs are replaced with a fresh UUID.
- The request ID is generated before route execution and is available through Fastify's request logger.
- The same identifier is returned as `X-Request-ID` on the response.
- The identifier is correlation metadata only. It is not an authentication credential, authorization assertion, tenant identifier, or secret.
- Request bodies, authorization headers, provider credentials, prompts, tool arguments, and response payloads are not added to the correlation contract.
- Durable audit records and execution receipts remain authoritative for consequential operations; a request ID or trace does not prove successful execution.

## Scope

This is an observability boundary repair only. It does not add a telemetry exporter, change database schema, change provider credentials, enable outbound communications, or authorize deployment.

## Verification

`src/server/requestCorrelation.test.ts` covers:

1. preservation of valid bounded IDs;
2. rejection of unsafe and oversized IDs;
3. generation when the header is absent; and
4. deterministic handling of repeated header values.

Exact-head CI/security status must be checked on the repair branch before merge. Provider-blocked Vercel checks do not count as passing CI.

## HTTP tracing

Fastify now creates a privacy-bounded `http.server.request` span for each request. Only the HTTP method and response status are recorded as span attributes. Request paths, query strings, headers, bodies, authorization data and provider content are excluded. The response log records the bounded request ID plus trace/span identifiers so an operator can correlate request logs with exported traces without treating telemetry as execution evidence.
