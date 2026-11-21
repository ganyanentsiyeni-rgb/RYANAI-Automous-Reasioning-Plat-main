# OpenTelemetry Instrumentation and Lifecycle Audit

**Audit date:** 2026-11-08  
**Repository:** `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`  
**Audited base:** `main` at `84dc1454cd6d5a39e2464788fd469bdf0a371370`  
**Programme:** [#1324 Engineering Intelligence and Observability](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/issues/1324)  
**Status:** Static source/configuration audit only. No application tests, live exporters, provider probes, production systems or external telemetry backends were exercised.

## Executive assessment

RyanAI already has a canonical OpenTelemetry SDK bootstrap, privacy-oriented span helpers, W3C trace-context persistence for durable agent jobs, and explicit spans around selected reasoning/model/tool/queue operations. The right next step is to complete coverage and contract gaps around those foundations, not add another SDK or replace the queue context implementation.

The current implementation is **partial tracing, not unified observability**:
- One canonical NodeSDK bootstrap exists.
- OTLP trace export is optional and configured by environment.
- Automatic Node instrumentation is explicitly disabled.
- Explicit spans cover selected agent paths, not the complete HTTP, database, Redis, worker, MCP, provider and studio lifecycle.
- No metric reader/exporter or application metric instruments were found in the inspected telemetry source.
- Logs are not shown to be correlated with trace/span IDs by the inspected code.
- Several useful attributes supplied by call sites are silently dropped by the current allowlist.

## 1. SDK ownership and startup lifecycle

### Canonical bootstrap

`src/telemetry.ts` owns the single NodeSDK lifecycle:
- `startTelemetry()` is idempotent within the module/process lifecycle.
- `OTEL_SERVICE_NAME` defaults to `ryanai-autonomous-platform`.
- `npm_package_version` is used for service version, falling back to `unknown`.
- Trace export is enabled only when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` is supplied.
- Automatic instrumentations are deliberately disabled.
- SIGTERM/SIGINT handlers call `shutdownTelemetry()`.
- Shutdown is idempotent through a shared promise and exporter errors are caught so telemetry shutdown does not throw into application control flow.
- Startup failure is caught and the application is intended to continue without telemetry.

Compatibility facades:
- `src/observability/telemetry.ts` calls the canonical `startTelemetry()`.
- `src/config/telemetry.ts` re-exports canonical SDK/lifecycle symbols.
- `src/telemetry/otel.ts` re-exports canonical SDK/lifecycle symbols.

These are compatibility facades, not separate SDK instances. Do not add another NodeSDK bootstrap.

### API entrypoint

`src/server/launcher.ts` imports local environment loading first, then `src/instrument.ts`, then `src/telemetry.ts`, before application route/service imports. The API launcher calls `shutdownTelemetry()` during its graceful shutdown sequence after closing the pool, Prisma clients and Fastify.

Important distinction: `src/instrument.ts` currently configures optional Sentry profiling when `SENTRY_DSN` is present. It is not the OpenTelemetry SDK bootstrap. The launcher's comment that tracing must precede application imports is only fully satisfied for OpenTelemetry because `src/telemetry.ts` is also imported before the application modules.

### Other process entrypoints

The root `telemetry:collect` script explicitly imports `src/telemetry.ts` before starting `src/mcp/systemServer.ts`. The inspected system MCP server does not currently create spans around tool listing, tool calls, or Docker log retrieval.

The initial import/call-site search did not find the canonical telemetry bootstrap in the standalone worker entrypoints or separate MCP server package. Treat their coverage as **not established**, not as proven absent, until every package script, Docker command and deployment process is inventoried. Candidate entrypoints to inspect include the studio worker, audiobook worker, coding worker and the separate `mcp-server` package.

## 2. Instrumentation coverage

### Existing explicit spans

The inspected explicit span call sites include:
- `src/agent/invoke.ts`: outer `agent.run` reasoning span.
- `src/agent/operations.ts`: `agent.model.invoke` spans and `agent.queue.process` span around claimed queued work.
- `src/engine/agentGraph.ts`: model invocation and selected tool invocations.
- `src/telemetry/queueContext.ts`: W3C context capture/restore used when creating and processing durable agent jobs.

### Coverage not established

No source evidence from this audit establishes complete tracing for:
- Incoming Fastify HTTP requests and route lifecycle.
- PostgreSQL/Prisma query spans.
- Redis commands and queue notification/listener lifecycle.
- Provider request retries, rate limits, timeout classes and response status (beyond enclosing model spans).
- MCP request/tool lifecycle in the system server or separate MCP service.
- Studio, audiobook and coding worker process lifecycle.
- External communication delivery callbacks.
- Sandbox execution lifecycle.
- Frontend/browser performance and user interaction.
- Deployment/build workflow events.

Because auto-instrumentation is disabled, these paths require deliberate manual instrumentation or a separately reviewed, privacy-configured instrumentation package. Do not simply enable every auto-instrumentation: review captured attributes, SQL statement handling, HTTP headers, URL query parameters, request/response bodies and error payloads first.

## 3. Attribute and privacy contract

`src/telemetry/core.ts` allowlists:
- `agent.operation`
- `agent.brain`
- `agent.tool`
- `agent.outcome`
- `agent.policy_outcome`
- `agent.error_type`
- `agent.retry_count`

String values are limited to 80 characters; finite numbers and booleans are accepted. Unknown keys and content-like values are dropped. `withTelemetrySpan()` records error status without recording the exception message and always ends the span.

Tests in `src/telemetry/core.test.ts` cover allowlist filtering, operation without an exporter and exception-message non-recording.

### Identified contract mismatch

Call sites currently pass `agent.model_override`, but this key is not in the allowlist, so it is silently discarded. This is not a security defect; it is an observability contract mismatch. Decide whether a bounded boolean field is useful and add a test before changing the allowlist.

Do not add model names, provider endpoint URLs, user IDs, prompts, completion text, message bodies, tool arguments/results, attachment metadata, authorization headers, secrets or raw provider errors to spans. Prefer bounded enumerations and opaque correlation identifiers. Durable audit records remain authoritative for consequential decisions.

### Sentry boundary to review separately

`src/instrument.ts` initializes Sentry profiling when configured, uses a 20% production trace sample rate and full profile-session sampling, and logs the caught initialization error object. This audit did not inspect Sentry's event filtering, PII settings, request-body capture, breadcrumbs or retention configuration. Treat Sentry privacy configuration as a separate security review item; do not assume the OpenTelemetry attribute allowlist applies to Sentry.

## 4. Durable queue trace propagation

`src/telemetry/queueContext.ts`:
- Injects only `traceparent` and `tracestate`.
- Excludes baggage and arbitrary carrier fields.
- Validates W3C traceparent structure and rejects all-zero trace/span IDs.
- Bounds printable tracestate to 512 characters.
- Persists JSON-safe values for Prisma JSON columns.
- Restores the extracted context before queue processing creates child spans.

The tests in `src/telemetry/queueContext.test.ts` cover valid context, malformed/all-zero IDs, baggage exclusion, restoration and invalid-context fallback.

Call sites inspected:
- Agent task creation in `src/agent/operations.ts`.
- PA delegation task creation in `src/agent/paDelegationService.ts`.
- Worker processing in `src/agent/operations.ts`.

### Propagation limitation

Queue context only correlates with an upstream operation when a valid active span exists at enqueue time. With inbound HTTP auto-instrumentation disabled and no explicit route span established in the inspected code, the current implementation may create queue jobs without a parent request context. The queue worker span still exists, but the end-to-end request-to-job trace relationship is not guaranteed.

The next implementation should add an explicit, privacy-safe boundary span or a carefully reviewed HTTP instrumentation layer and test the parent-to-enqueue-to-worker relationship without persisting baggage or request content.

## 5. Metrics and logs

### Metrics

The inspected root `package.json` includes OpenTelemetry API, SDK, resource, semantic-conventions, auto-instrumentation and OTLP trace exporter packages. The inspected canonical bootstrap configures a trace exporter only. No metric reader/exporter or application metric instrument was identified in the initial search.

Do not add a second observability stack. First determine whether a supported metrics backend/exporter already exists in the deployed environment and whether a metrics package is already present in the complete lockfile. Then define a small, bounded metric set:
- request/worker counts by bounded outcome;
- queue depth and queue wait duration;
- worker active/idle/failed state;
- provider request latency and normalized outcome;
- API readiness and dependency state;
- CI/review evidence state.

Metrics must avoid high-cardinality labels such as user IDs, run IDs, prompts, arbitrary model strings or endpoint URLs. Use histograms for latency distributions and counters/gauges for appropriately defined counts/current state.

### Logs

This audit did not establish trace/span ID injection into Fastify/Pino or worker logs. Add correlation only through a documented, tested logging hook; never dump active context, headers or arbitrary baggage. Keep raw logs access-controlled and separate from chart aggregation.

## 6. Lifecycle and reliability risks to test

Before changing SDK lifecycle code, add isolated tests for:
- repeated `startTelemetry()` calls create one SDK and register one pair of signal handlers;
- startup with no exporter remains valid and does not claim exported telemetry;
- exporter initialization/start failure does not prevent API startup;
- shutdown is idempotent and awaited during graceful API shutdown;
- SIGTERM/SIGINT and explicit shutdown do not race or double-flush;
- standalone worker shutdown drains/ends telemetry before process exit;
- one service/process does not accidentally initialize two SDKs through compatibility facades;
- telemetry exporter failure never changes authorization, queue claim, job completion or approval behavior.

The current SDK lifecycle was inspected statically only; no exporter was connected and no signal/shutdown integration test was run in this audit.

## 7. Recommended implementation sequence

1. Inventory every deployed process entrypoint and telemetry initialization point, including Docker commands and separate package scripts.
2. Add missing tests around idempotent startup, failure isolation, graceful shutdown and one-SDK-per-process behavior.
3. Reconcile the bounded attribute contract and its call sites, including the dropped `agent.model_override` attribute.
4. Add privacy-safe request boundary spans and verify request-to-queue-to-worker propagation.
5. Instrument provider/worker/queue outcomes using bounded fields and stable semantic names.
6. Decide metrics/exporter integration only after verifying the available backend and existing dependencies.
7. Correlate structured logs with trace IDs under a reviewed redaction policy.
8. Publish a source-backed telemetry capability matrix for API, agent, queue, MCP, studio, audiobook, coding worker and frontend.

Each implementation increment should be a separate PR with tests, exact-head CI/security evidence and human review.

## 8. Safety boundaries

This audit makes no production changes and authorizes no exporter endpoint configuration, provider probes, secret changes, Sentry/OTel data transmission, paid telemetry service, production migration, production deployment or live external communication. Do not enable new telemetry export until data minimization, destination ownership, retention, access control and failure behavior are reviewed.

Production remains NO-GO pending the separate Beta Readiness gates and separate release authorization.
