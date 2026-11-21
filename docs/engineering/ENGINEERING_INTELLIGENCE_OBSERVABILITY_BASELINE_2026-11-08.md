# RyanAI Engineering Intelligence and Observability Baseline

**Date:** 2026-11-08  
**Baseline branch:** `main`  
**Baseline commit:** `84dc1454cd6d5a39e2464788fd469bdf0a371370`  
**Tracking:** [Engineering Intelligence and Observability Programme #1324](https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/issues/1324)  
**Status:** Repository source/configuration audit; not a live runtime certification.

## 1. Purpose

Record the existing implementation before adding new Copilot governance, telemetry, or visualization code. This baseline prevents duplicate SDKs, duplicate health endpoints, ungrounded dashboards, and assumptions about GitHub plan or repository settings.

## 2. Engineering intelligence baseline

### 2.1 Copilot code review

`.github/workflows/enforce-main-protection.yml` includes a ruleset payload with:

- `copilot_code_review`, configured for review on push and draft PRs;
- one required approving review;
- dismissal of stale approvals;
- required review-thread resolution;
- a named set of CI/security status checks;
- non-fast-forward and deletion restrictions;
- an empty bypass actor list in the payload.

This workflow is `workflow_dispatch` only. It requires the exact confirmation value `ENFORCE-MAIN-PROTECTION` and the `GH_ADMIN_TOKEN` secret. It was not dispatched during this audit. The workflow source is not evidence that the live ruleset is active or effective. Live settings require authorized read-back.

The connected GitHub repository metadata reports `allow_auto_merge: false`. Keep auto-merge disabled and retain independent human approval.

### 2.2 Exact-head evidence

At the baseline commit, the connected commit-status query returned no status entries. The connected workflow-run query returned no PR-triggered runs for this main commit. This means the audit has no current check evidence to certify; it does not mean checks passed or failed.

Continue to classify each check separately as passed, failed, queued, skipped, cancelled, missing, or provider-blocked. A configured workflow or a queued/skipped result is not a pass.

## 3. Observability baseline

### 3.1 OpenTelemetry lifecycle

Current source has one canonical NodeSDK lifecycle:

- `src/telemetry.ts` owns SDK startup, idempotent lifecycle state, optional OTLP HTTP trace exporter configuration, and SIGTERM/SIGINT shutdown handling.
- `src/observability/telemetry.ts` is a deprecated compatibility facade that calls the canonical `startTelemetry()`.
- `src/config/telemetry.ts` is a deprecated compatibility re-export of the canonical SDK and lifecycle functions.
- `src/telemetry/otel.ts` is also a deprecated compatibility re-export.

Therefore, the older design note `docs/architecture/RYANAI-OPENTELEMETRY-AGENT-OBSERVABILITY-DESIGN.md` describing three independent SDK implementations is stale relative to the inspected current source. Reconcile the design note in a later focused documentation change; do not recreate multiple SDKs.

### 3.2 Privacy-safe spans and queue context

- `src/telemetry/core.ts` exposes `withTelemetrySpan()` and `safeTelemetryAttributes()`.
- Span attributes are restricted to a bounded allowlist of agent metadata keys; prompts, arguments, results and exception messages are not recorded by this helper.
- `src/telemetry/queueContext.ts` and its tests provide trace-context propagation scaffolding for queued work.

The existence of these primitives does not prove every API, agent, provider, MCP, worker or sandbox path uses them. A call-site and process-entrypoint inventory is required before extending instrumentation.

No metric instrument was found by the initial source search for `meter.createCounter`. This is not a complete proof that no metrics exist; continue a broader source inventory before selecting a metrics implementation.

### 3.3 Privacy requirements

Preserve the existing safe defaults:

- No prompt, completion, message, attachment, transcript, raw tool argument/result, token, cookie, connection string or secret capture.
- Explicit bounded attribute allowlists and sanitization before export.
- Opaque correlation identifiers rather than personal identifiers.
- Telemetry failure must not alter authorization, approval, task execution or side-effect behavior.
- Durable audit records for consequential actions remain independent of an external telemetry exporter.

## 4. Dashboard and metrics baseline

### 4.1 Existing source-backed views

- `src/pages/Dashboard.tsx` uses freshness-aware platform health and PA heartbeat snapshots.
- `src/components/dashboard/RyanAICockpit.tsx` models brain status, latency, check time, last success and last error.
- `src/agent/operations.ts` contains provider challenge-probe logic that records health and latency when the challenge succeeds.
- `src/pages/AdminConsole.tsx` is an authenticated administrative view that combines process metrics, pending actions and engineering approvals.

### 4.2 Admin metrics endpoint

`src/server/routes/metrics.ts` exposes the admin-only `/api/admin/metrics` endpoint. Its documented purpose is process uptime and memory reporting. Database status is intentionally `unknown`; dependency health is a separate `/health` contract.

Do not turn a process uptime value into a platform-availability claim. Do not infer database health from the metrics endpoint. Preserve the current admin access boundary.

### 4.3 Chart dependency inventory

The inspected root `package.json` has no chart/plotting dependency matching Chart.js, Recharts, Visx, Nivo, ECharts or D3. No visualization dependency has been added by this baseline.

Before selecting a library, compare bundle size, React/TypeScript compatibility, accessibility, responsive rendering, licensing, testability and mobile usability. Prefer an existing compatible dependency if a later full lockfile/source audit discovers one. No paid visualization service is authorized.

## 5. Implementation sequence

1. **Complete source inventory:** map telemetry imports and initialization across every process entrypoint; enumerate spans, metrics, trace propagation, provider probes, queue lifecycle and health endpoints.
2. **Copilot evidence contract:** document supported API metadata and actual account/repository permission limitations. Record reviewer attribution and source provenance only when GitHub supplies it. Keep Copilot advisory.
3. **Unified telemetry contract:** define versioned metric/event/span dimensions, source identity, timestamps, freshness, outcome and safe correlation fields. Reuse existing OpenTelemetry primitives where appropriate.
4. **Visualization primitives:** implement accessible KPI, line, bar, distribution, relationship, heatmap, flow and timeline views only when the source data supports the chart semantics.
5. **First module slice:** prioritize Admin Console, Operator Console, Cockpit, GitHub Integration, Inference Console and Beta Readiness. Integrate Quant Lab, Memory Vault, Audiobook Studio and Communications only where reliable telemetry exists.
6. **Verification:** add tests for redaction, freshness, unavailable/stale states, source attribution, units, empty data, chart data correctness and access boundaries. Record exact-head CI/security results and human review for each PR.

## 6. Chart selection rules

| Question | Appropriate visualization | Required source data |
|---|---|---|
| What changed over time? | Line/area | Timestamped samples with stable units |
| Which categories differ? | Bar/column | Comparable category aggregates |
| How are values distributed? | Histogram/box plot | Sufficient underlying observations |
| Are two measures related? | Scatter/bubble | Paired observations with defined units |
| Where do failures cluster? | Heatmap | Time/category matrix with defined aggregation |
| How does work flow? | Sankey | Counted, attributable source-to-destination transitions |
| What depends on what and when? | Gantt | Explicit task durations and dependency links |
| What needs attention now? | KPI/status card | Fresh, source-backed current snapshot |

Do not draw a historical trend from a single point-in-time snapshot. Every view must show data source, last-updated time, time range and units, and must distinguish healthy, degraded, stale, unavailable and unknown.

## 7. Scope and safety boundaries

This baseline and its follow-up PRs do not authorize production deployment, production database migrations or data changes, secret creation/modification/rotation, paid upgrades, live external communications, auto-merge, ruleset dispatch/bypass, provider credential probes, or changes to real-money trading behavior.

Use separate reviewable branches. Reconfirm the base SHA before implementation. Do not merge without required exact-head CI/security evidence and human approval. Production remains NO-GO until the separate Beta Readiness gates are satisfied and production rollout is separately authorized.
