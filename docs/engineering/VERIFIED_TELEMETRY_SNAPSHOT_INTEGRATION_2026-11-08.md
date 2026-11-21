# Verified telemetry snapshot integration — 8 November 2026

## Scope

This increment connects existing timestamped runtime/provider observations to the shared `ryanai.telemetry.metric/v1` contract and the reusable `TelemetryMetricCard`. It does not add collectors, exporters, persistence, chart dependencies, or synthetic live values.

## Integrated sources

| Source | Metrics represented | Timestamp / freshness | UI integration |
|---|---|---|---|
| `GET /api/admin/metrics` | API process uptime (seconds); process RSS memory (MiB) | Response `timestamp`; 90-second freshness window | Admin Console |
| `GET /api/agent/ops/brains` | Count of providers whose reported status and last-success timestamps are currently fresh | Response `timestamp`; 60-second snapshot window, with per-provider checks still evaluated separately | Command Cockpit |

The Admin metrics route is protected by the existing administrator pre-handler. Its timestamp is generated with the response. Its database field deliberately remains `unknown`; this increment does not reinterpret process uptime or memory as database health.

The brain endpoint's response timestamp is accepted only when it parses as a finite, non-future timestamp. Provider readiness is counted only when the snapshot and individual provider checks satisfy existing freshness rules. Missing or stale snapshots remain unavailable/stale rather than being converted to zero healthy providers.

The existing `/health` cards continue to display their own source timestamp and state. Pending approvals are not represented as timestamped telemetry because the current combined queue response has no verified observation timestamp.

## Contract and presentation behavior

- Snapshot fields preserve metric ID, label, numeric value, unit, source, observation time, freshness and availability status.
- Non-finite values are normalized to `null` by the shared contract.
- The shared card uses contract freshness when a snapshot is supplied and displays the contract source, observation time and unit.
- Legacy state cards can continue using the same component with their source timestamp and explicit status.
- No historical sample store or durable time-window query is currently connected. A single snapshot is not a time series.

## Visualization decision

Do not add line/area charts yet. The inspected sources return current snapshots, not a persisted sequence of timestamped samples. A trend chart would therefore imply history that the platform does not currently provide. Once an existing durable event/metric history is verified, a separate implementation can add bounded time windows, retention, aggregation, missing-data handling and source drill-down.

## Validation status

Tests are added for contract-backed card rendering, source/unit disclosure and unavailable/stale states. They must pass on the exact PR head with the normal CI, typecheck, build and security gates. This document does not claim those checks have run.
