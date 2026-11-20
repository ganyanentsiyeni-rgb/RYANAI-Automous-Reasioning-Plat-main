# RyanAI Admin Resilience, Recovery and Maintenance — Engineering Contract

**Status:** Implementation plan and acceptance contract; not a claim of operational readiness.  
**Accountable module:** Admin Console (Admin Steward) with Operations Center (Reliability Coordinator).  
**Approval boundary:** Code may be proposed on this branch. Production restore, production migration, secret changes, infrastructure changes, paid upgrades and production deployment remain separately gated.

## Current repository baseline

- `src/ha/disasterRecovery.ts` is a narrow model-provider failover helper, not a platform disaster-recovery manager.
- `scripts/backup-on-startup.mjs` optionally runs a PostgreSQL dump and configured Supabase Storage copies. It is disabled unless explicitly configured, does not block API startup on failure, does not implement retention, and does not prove restorability.
- `docs/startup-backups.md` documents the required private bucket and environment configuration. No credentials or bucket changes are part of this project approval.
- `src/engine/selfPatchSkill.ts` proposes source changes as isolated GitHub branches and PRs. It does not deploy or merge. `src/components/SelfPatchPanel.tsx` exists but was not previously integrated into AdminConsole.
- `scripts/pagerduty_manager.py` provides a CI-oriented maintenance-window context manager; there is no complete Admin UI maintenance lifecycle.
- `src/events/intelligenceEventInbox.ts`, `src/events/eventWorker.ts`, `src/lib/offlineTaskOutbox.ts` and `src/lib/offlineTaskSyncClient.ts` are existing continuity foundations to inspect and reuse.

## Admin Console workstreams

### A. Backup management

Required UI states: configuration status, last attempted backup, last successful backup, age/freshness, backup inventory, artifact size, manifest, checksum/integrity state, retention status, failure reason and evidence link. Missing configuration must be shown as unavailable, never as zero backups or healthy.

Required operations:
- Preflight checks for direct PostgreSQL dump capability, private destination bucket, source/destination separation, storage reachability and available space/limits.
- Explicitly initiated backup with a durable job receipt and bounded execution.
- Inventory and manifest verification, content digest/checksum, artifact metadata and retention-policy visibility.
- Retention preview before any deletion. Deletion requires separate owner confirmation and must preserve configured recovery-point objectives.
- Never include secrets in manifests, logs, UI, artifacts or PRs.

A backup job passing is not a restore pass. Redis, secret values and host configuration are not implied to be covered by the current startup backup.

### B. Restore and disaster recovery management

Required UI states: incident/recovery case, affected trust zone, selected recovery point, artifact integrity, isolated target, restore progress, validation results, RPO/RTO measurements, operator and approval receipt.

Required sequence:
1. Declare and scope the incident; preserve logs/evidence.
2. Isolate affected workloads where separately authorized.
3. Select a verified recovery point and validate checksums/signatures.
4. Restore only into an isolated non-production recovery target for the drill.
5. Validate schema, migration ledger, authentication, RLS, application health, event continuity and critical workflows.
6. Record achieved RPO/RTO, data-integrity report, gaps and rollback path.
7. Production recovery remains a separate explicit approval and controlled operator action.

No UI control may restore over production by default. A missing or ambiguous target must fail closed. A backup listing, successful dump, or process health response is not proof of recovery.

### C. RyanAI self-patches

- Integrate the existing SelfPatchPanel into AdminConsole only for the server-verified RyanAI owner.
- Enforce `requireOwner` server-side; UI visibility is not an authorization boundary.
- Continue to use the existing isolated GitHub branch/PR proposal pipeline, secret/path validation and exact-base commit checks.
- Show proposed, rejected, conflict, unavailable and CI/review states distinctly.
- No direct filesystem patching on managed production hosts, auto-merge, bypass, automatic deployment or self-approval.
- Require exact-head CI/security evidence and independent human review.

### D. Maintenance management

Required UI states: service/component, planned window, timezone, start/end, reason, impact, owner, affected workloads, approval, active/expired state and audit receipt.

Required operations:
- Read-only maintenance calendar and current window status.
- Create/update/cancel a maintenance request with owner/admin authorization and an immutable audit trail.
- PagerDuty integration is available only when existing protected credentials are configured; do not create or modify credentials.
- Expiry and cleanup must be bounded and observable.
- Maintenance windows must not silently suppress security alerts, erase telemetry, change service configuration or trigger deployments.
- Service drain/restart/scale actions are out of scope without separate infrastructure approval.

## Cross-cutting requirements

- Reuse existing PostgreSQL event/audit infrastructure and existing APIs where possible; do not add schema migrations until ownership and migration history are inspected.
- Admin Console access remains administrator-only; destructive or owner-level actions require server-side owner verification and exact-action confirmation.
- Every operation has a correlation ID, idempotency key, actor, target, timestamp, outcome, error classification and evidence receipt.
- Explicit states: `not_configured`, `unavailable`, `queued`, `running`, `succeeded`, `failed`, `cancelled`, `stale`, `not_verified`, `awaiting_approval`.
- Read failures preserve last-known values but mark them stale/unavailable.
- No secrets or private payloads in UI/logs. TLS certificate verification remains enabled.
- Tests cover authorization, owner-only actions, idempotency, retries, concurrent operations, cancellation, partial failures, audit integrity and safe recovery-target validation.
- CI/security evidence must match the exact PR head SHA. Queued, skipped, cancelled, missing or provider-blocked checks are not passes.

## Delivery sequence

1. Owner-only self-patch UI integration and route authorization.
2. RYAN-RELAY shared skill/model-role contract mapped to the existing Operations Center module.
3. Owner-only self-patch UI integration and RYAN-RELAY shared skill/model-role contract (implemented in the preceding branch increment).
4. Admin resilience status, owner-triggered PostgreSQL backup, read-only private-storage inventory, retention preview and route authorization tests (implementation present; runtime verification pending).
5. Isolated restore-drill workflow and evidence report; no production target.
3. Read-only Admin UI inventory and health contracts for backup, recovery and maintenance, with explicit unknown states.
4. Backup job/inventory/integrity APIs and tests using existing private storage configuration.
5. Isolated restore-drill workflow and evidence report; no production target.
6. Maintenance request/window APIs and Admin UI, with optional existing PagerDuty integration.
7. End-to-end failure/recovery, authorization, security and mobile usability tests.
8. Separate review of any production activation; no deployment or production mutation is implied.

## Definition of operational

A feature is operational only when its backend action, authorization, durable state, audit receipt, failure handling, UI state, tests and runtime verification all work together. A visible panel, configured environment variable, queued workflow or successful unit test alone is insufficient.
