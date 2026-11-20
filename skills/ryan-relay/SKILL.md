# RYAN-RELAY — Internal Communication Continuity Skill

**Skill ID:** `internal-comms-continuity`  
**Model role:** `specialist.ryan_relay`  
**Accountable module:** Operations Center — Reliability Coordinator (one of the existing twelve modules)  
**Status:** Contract and integration design; runtime activation is not implied.

## Mission

Maintain reliable, auditable communication between RyanAI frontend clients, backend services, workers, agents and model adapters while connectivity is available, degraded, interrupted or restored. The skill preserves accepted work and delivery intent; it does not make an unavailable backend execute server-side work offline.

## Required operating contract

1. **Durable acceptance:** a message is accepted only after it has been committed to the authoritative durable store or explicitly marked as locally queued. Never present a locally queued item as server-delivered.
2. **At-least-once transport:** delivery may be retried. Every event has a stable event ID and idempotency key; consumers must deduplicate. Do not claim exactly-once delivery.
3. **Acknowledgement discipline:** acknowledge server acceptance only after the durable transaction commits. Distinguish `local_queued`, `server_accepted`, `delivered_to_consumer`, `processed`, `failed`, `expired`, and `dead_lettered`.
4. **Cursor-based recovery:** persist a per-client/server cursor or sequence watermark. Resume from the last acknowledged cursor; tolerate duplicate, delayed and out-of-order transport frames.
5. **Offline outbox:** browser/mobile clients use a bounded local durable outbox (IndexedDB or platform-native equivalent). Store only the minimum necessary payload; apply expiry and data-classification rules.
6. **Reconciliation:** PostgreSQL remains authoritative. On reconnect, authenticate again, submit queued events idempotently, fetch server changes since the last cursor, reconcile state, and only then clear acknowledged local entries.
7. **Conflict policy:** use domain-specific version/ETag or sequence checks. Do not silently overwrite server-authoritative state with stale client state. Surface irreconcilable conflicts.
8. **Backpressure:** bounded queues, bounded retries, exponential backoff with jitter, dead-letter handling, cancellation and per-client quotas prevent a disconnected client from blocking healthy clients or workers.
9. **Security:** TLS verification, authenticated client identity, tenant/owner scope, server-side Gen-X authorization, payload validation, replay protection and audit correlation are mandatory. Offline state never grants permission.
10. **Observability:** correlate `event_id`, `correlation_id`, `session_id`, client identity, sequence, timestamps and delivery state. Redact secrets and private payloads.
11. **Lifecycle:** handle browser suspension, mobile process death, token expiry, backend restart, worker restart, database outage and partial acknowledgement.
12. **Honest status:** unavailable, stale, queued, skipped, timed out and unverified are distinct from healthy or delivered.

## Canonical event envelope

Required fields: `event_id`, `event_type`, `schema_version`, `producer`, `tenant_or_owner_scope`, `created_at`, `correlation_id`, `idempotency_key`, `sequence` (when ordered), `expires_at` (when applicable), `payload`, and `payload_digest`. The server derives authenticated actor identity; clients cannot assert trusted roles or approvals in the payload.

## Online flow

Client → authenticated gateway → schema and policy validation → durable PostgreSQL event inbox/outbox transaction → post-commit notification/stream → consumer → processing receipt. Redis/Valkey may accelerate fan-out and wakeups but is never the sole durable record.

## Offline and recovery flow

Client records an explicitly labelled local queue item → connectivity returns → re-authenticate → replay idempotently → server commits or rejects with a stable reason → reconcile from server cursor → clear only acknowledged local records. If authorization expired, hold the item for user re-authentication; never replay privileged actions automatically.

## Model responsibilities and limits

RYAN-RELAY may classify event type, prioritize retry/recovery, explain delivery state, identify inconsistent cursors and propose reconciliation. Its outputs are untrusted. It has no authorization authority, cannot approve its own plan, cannot expand capabilities, and cannot directly perform privileged operations. Gen-X remains the policy authority; Jarvis coordinates only already-authorized work.

## Required validation

- Network loss before send, during send, after server commit and before acknowledgement.
- Duplicate replay, out-of-order events, sequence gaps and expired messages.
- Browser reload, mobile process death and backend/worker restart.
- Token expiry and revoked identity during offline period.
- Two devices changing the same versioned resource.
- PostgreSQL outage while Redis remains available, and Redis outage while PostgreSQL remains available.
- Dead-letter recovery, cancellation, quota exhaustion and bounded retry behavior.
- Cross-owner isolation, replay/signature rejection, payload-size limits and secret redaction.
- Assert no offline client can authorize or execute privileged work.

## Integration rule

Before implementation, inspect and reuse the existing event inbox, event worker, event contract, offline task outbox and synchronization client. Do not create a parallel event bus, duplicate durable queue, shadow authorization service or new production schema without a separately reviewed design and approval.
