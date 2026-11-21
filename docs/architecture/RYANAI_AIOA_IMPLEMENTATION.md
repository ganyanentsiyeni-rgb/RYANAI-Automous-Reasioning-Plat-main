# RyanAI Autonomous Intelligence & Operational Awareness (AIOA)

**Status:** Approved engineering programme; implementation contract and first domain slice. This document does not claim that the end-to-end features are already integrated or runtime-verified.

## Outcome

RyanAI must continuously understand and report what it can do, what it is doing, what is blocked, whether it is online or offline, and what requires the owner's attention. The same task identity, policy decision, state history, and evidence must be visible across the backend, dashboard, settings/preferences, Operator Console, Cockpit, Memory Vault, voice surfaces, and RyanAI Comms.

## Product requirements

### 1. Durable intelligent memory
- PostgreSQL remains authoritative for durable memory and task history; pgvector remains the semantic retrieval index.
- Preserve owner/tenant scope, source provenance, timestamps, model/version metadata, retention and deletion propagation.
- Link tasks, decisions, conversations, modules, attachments and execution evidence without treating model output or retrieved content as trusted instructions.
- Memory reads/writes must pass the authenticated API and Gen-X policy boundary. Redis is coordination/cache only.
- Offline mode may use explicitly authorised local/cached memory. Local cache must declare its last sync time and freshness; stale cache is never represented as current cloud state.

### 2. Task lifecycle and durable execution
Canonical states: queued, planning, awaiting_approval, running, retrying, paused_offline, blocked, succeeded, failed, cancelled.
- Every task has stable ID, owner, module/skill, created/updated timestamps, dependencies, execution surface, required capabilities, permission scope, retry policy, cancellation state, event history and evidence references.
- Use idempotency keys, leases/heartbeats, bounded retries, checkpoints, cancellation and crash recovery. Duplicate delivery must not cause duplicate side effects.
- A task can be succeeded only after its declared postconditions and verification evidence pass.
- Approval binds to the exact action payload/version/digest; changed inputs invalidate approval.
- Keep database schema/migration work separate from this first contract while the existing Supabase/Prisma queue reconciliation review is active.

### 3. Online/offline capability truth
- Detect connectivity separately for internet, API, database, queue, model runtime, speech runtime and each provider.
- Determine capability from recent successful probes, not merely configured settings.
- Local-only work may continue offline when its local dependencies and permissions are present.
- Remote-only work remains queued/paused with a clear reason and resumes only after a fresh dependency probe and policy re-check.
- Hybrid work may use a declared local fallback; never silently switch a local-only request to a cloud provider.
- Synchronisation is conflict-aware, owner-scoped and idempotent. Record the source and timestamp of every state transition.

### 4. Unified task awareness and warnings
- One backend status contract feeds Dashboard, Cockpit, Operator Console, module pages and Comms.
- Each task exposes state, module, connectivity, execution surface, blocker, next action, last update, progress evidence and verification reference.
- Progress is shown only when measurable. Unknown, stale, missing, queued, skipped, cancelled and provider-blocked remain distinct.
- Standard indicators: ✓ verified; ◉ executing; ◷ queued; Ⅱ waiting/approval; ☾ offline; ▲ attention/failure; ⊘ cancelled.
- Warning levels: none, warning, critical. Stale telemetry must be labelled stale and must not be counted as healthy.
- Provide a global activity feed, per-task detail, filter/search, history, acknowledgement and notification preferences.

### 5. Voice integration
- Voice listening, transcription, reply generation and speech output are first-class Comms skills with explicit capability and permission contracts.
- Support push-to-talk and explicitly enabled wake-word/background listening only where the OS/platform permits. Show microphone state, consent and active capture indicators.
- Voice alerts are event-driven and priority-based: critical failures immediately; approval/blocker/connectivity changes promptly; routine progress grouped or silent.
- Do not announce completion without verification. Do not repeatedly announce the same event; deduplicate by event ID and user preference.
- Support local ASR/TTS offline only when a compatible model/runtime is installed and tested. Otherwise clearly report voice capability unavailable.
- Respect Android microphone/background execution/battery permissions and user quiet hours. Voice never bypasses outbound communications approval.

### 6. Module skill registry
Each skill declares ID, module, description, version, online/offline execution modes, required tools/capabilities, permissions, input/output schema, resource bounds, verification method, failure/recovery policy and enabled state.
- A skill is available only when enabled and all required capabilities and permissions are present.
- A registry entry is not proof of runtime readiness.
- Module ownership:
  - Admin Console: policy, role and configuration visibility; no model-controlled privilege changes.
  - Operator Console: task creation, planning, execution state, approvals, cancellation and recovery.
  - Cockpit/Dashboard: cross-module operational state and warning summaries.
  - Memory Vault: contextual retrieval, provenance, correction, retention and deletion.
  - Comms: ASR, TTS, message preparation, human review and provider-confirmed dispatch.
  - Audiobook Studio: authorised document/audio processing and durable render tasks.
  - Quant Lab: isolated research and virtual paper-trading tasks only.
  - Inference Console: model routing, health, fallback and benchmark evidence.
  - GitHub/Infrastructure: scoped read-only monitoring by default; writes require explicit authorization.
  - Voice: listening, transcription, response playback and alert delivery.

### 7. Settings and preferences
Expose user-controllable settings for:
- Global awareness enabled; dashboard/Cockpit/Operator/Comms surfaces.
- Online/offline status visibility and stale-data thresholds.
- Per-module skill enablement (subject to administrator policy and actual capability).
- Voice listening mode, microphone permission state, voice reply, alert voice, volume, quiet hours and critical-alert override.
- Alert categories, priority, deduplication, digest frequency and acknowledgement.
- Offline cache use, sync behavior and local-model preference.
- Accessibility: text labels alongside icons, contrast, screen-reader labels and reduced motion.

Defaults must be privacy-preserving: background listening off until explicitly enabled; outbound communication dispatch remains human-reviewed. A UI toggle cannot grant backend permissions or activate an unconfigured provider.

### 8. RyanAI Comms
- Unify voice task state and message task state without collapsing their distinct permissions.
- Display transcription confidence/language, TTS availability, channel/provider health, delivery callback state and human-review state.
- Keep draft, approved, dispatched, provider-accepted, delivered, failed and unknown distinct.
- Live WhatsApp/SMS/voice/email requires provider callback, verified owner destination and explicit authorization for that action. No inferred delivery success.

## Required integration surfaces

| Surface | Required behavior |
| --- | --- |
| Backend/API | Authenticated task, capability, connectivity, preference, event and report contracts; policy enforcement; durable state and audit evidence |
| Worker/queue | Lease, heartbeat, idempotency, checkpoint, retry, cancellation, offline pause and graceful shutdown |
| Dashboard | Global status summary, active task list, connectivity banner, warning center and drill-down |
| Cockpit | Live/stale service and brain health plus task/worker activity, with timestamps |
| Operator Console | Plan, authorize, run, pause, resume, cancel and verify tasks |
| Settings/preferences | All awareness, skill, voice, privacy, offline and alert controls; distinguish configured/enabled/available/healthy |
| Memory Vault | Task-linked context, provenance, freshness and authorised retrieval |
| Comms/Voice | Listening and speech capability state, spoken alerts, transcripts, human review and provider-confirmed outcomes |
| Module pages | Shared task indicator and module-specific skill readiness, blockers and evidence |

## Acceptance gates

1. Contract/unit tests for every task state, connectivity mode, approval boundary, stale-data condition and voice priority.
2. API tests for owner isolation, authorization, preference validation and task event history.
3. Worker tests for duplicate delivery, lease expiry, retry limits, checkpoint/restart, cancellation, offline pause and reconnect.
4. Frontend tests for all indicators, accessible text labels, preferences, stale telemetry and cross-surface consistency.
5. Voice/Comms tests for microphone permission denial, local runtime unavailable, offline ASR/TTS, quiet hours, alert deduplication, human-review gate and provider callback verification.
6. Module contract tests proving skills are unavailable when dependencies or permissions are missing.
7. End-to-end test: create task → plan → authorize → execute locally offline → queue remote dependency → reconnect → resume idempotently → verify → report in UI and voice.
8. Exact-head CI, security scans and human review. Queued/skipped/missing checks are not passes.

## Safety and rollout
- Feature implementation may be proposed on dedicated branches and reviewed via PR.
- No production deployment, production database migration, secret/environment change, paid resource, auto-merge or live outbound dispatch is included.
- Do not modify the active Supabase/Prisma migration history or apply hosted SQL as part of this programme.
- No model or agent may grant itself permissions, approve consequential work, merge code or deploy.
- Roll out behind explicit settings/feature flags only after tests; settings expose controls but cannot override policy or missing runtime capability.

## Delivery sequence
A. Domain contracts and deterministic state/skill/alert evaluators.
B. Backend persistence/API and worker lifecycle integration, with separate reviewed migration proposal if needed.
C. Dashboard, Cockpit, Operator Console and Settings/preferences integration.
D. Voice and Comms integration, including offline capability detection and event-driven spoken alerts.
E. Module-by-module skill registry adoption and end-to-end acceptance.
