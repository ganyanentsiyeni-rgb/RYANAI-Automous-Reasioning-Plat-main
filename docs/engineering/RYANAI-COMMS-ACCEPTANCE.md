# RyanAI Comms acceptance gates

## Purpose and scope

This document defines the evidence required before the RyanAI Self-Patch subsystem may report Comms as functional. RyanAI only. Gen-X and Jarvis are excluded from this subsystem. This is an acceptance contract, not a declaration that any provider is configured or that a message was delivered.

## Current code findings (repository inspection)

- The Comms plugin contains Twilio-backed WhatsApp, SMS and voice dispatch paths.
- Outbound Twilio dispatch requires a configured HTTPS status callback URL and requires it to match the URL used for webhook signature verification. If this check fails, the handler returns before sending a provider request.
- The Twilio status webhook updates the durable communication history and the approval's provider status. A successful API response or provider acceptance is not proof of final delivery.
- The Comms authorization module imports and calls the Gen-X policy engine for approval creation, approval confirmation, and outbound authorization/claim. This is a hard RyanAI-only integration blocker; do not bypass it or weaken it.
- The PA observer imports Gen-X policy code and only exposes EventEmitter observations. No RyanAI-only Self-Patch-to-PA event adapter is established by the merged audit PR.
- The email approval endpoint currently returns HTTP 503 because a delivery-callback-capable email provider is not integrated. SMTP transport configuration alone is not delivery evidence.
- Resend webhook code currently includes inbound processing; inbound webhook support does not establish outbound delivery receipt support.

## Acceptance matrix

| Channel | Current implementation evidence | Required proof before marked functional |
| --- | --- | --- |
| WhatsApp | Twilio dispatch path; HTTPS status callback required | Verified owner destination; separately authorized test; signed callback; provider message ID; final delivered/read or terminal failure status recorded |
| SMS | Twilio dispatch path; HTTPS status callback required | Verified owner destination; separately authorized test; signed callback; provider message ID; final delivered or terminal failure status recorded |
| Voice | Twilio call path; callback and voice action URL configuration required | Verified owner phone; separately authorized test call; signed status callback; call lifecycle and terminal status recorded |
| Email | Approval route explicitly disabled pending callback-capable provider | Integrate a provider with authenticated delivery webhooks; test bounce/delivered/failure outcomes; do not infer delivery from SMTP/API acceptance |

## RyanAI-only PA bridge requirements

1. Define a RyanAI-owned, versioned event contract for audit findings and Comms delivery receipts.
2. Authenticate and validate event origin, schema version, repository identity and commit SHA.
3. Make the PA bridge consume the event contract without importing Gen-X or Jarvis modules.
4. Keep policy evaluation deny-by-default until a separately reviewed RyanAI-owned authorization contract exists. Do not replace Gen-X with permissive allow logic.
5. Persist delivery attempts and receipts with idempotency, correlation IDs, timestamps and terminal states.
6. Treat missing callbacks, timeouts and ambiguous provider outcomes as unknown—not delivered.
7. Keep all provider credentials outside reports and logs; inventory variable names/configuration presence only.

## Required end-to-end evidence

For each configured environment (development, preview/staging, production only if already configured), record:

- Environment identifier and provider service/project identity.
- Presence-only configuration inventory; never copy secret values.
- Health/readiness and webhook reachability checks.
- Owner destination verification result without exposing the destination.
- Explicit test authorization reference and timestamp.
- Provider request/correlation ID, redacted.
- Authenticated callback verification result.
- Durable history record and final provider status.
- Negative tests: missing credentials, invalid signature, unverified destination, expired approval, duplicate idempotency key, callback timeout, provider rejection and unsupported email delivery.
- Exact source commit SHA, test run IDs and artifact references.

No test should send a live WhatsApp, SMS, voice call or email unless the owner separately authorizes that specific test and the destination is verified. Do not send test messages as part of CI.

## Status vocabulary

Use only these distinct states: `not_configured`, `blocked_by_policy_boundary`, `blocked_by_provider`, `queued`, `accepted_by_provider`, `delivered`, `failed`, `unknown`, `not_tested`.

Only an authenticated provider callback mapped to a durable record may establish `delivered`. `accepted_by_provider`, a configured environment variable, a healthy route, or a successful HTTP response must never be promoted to `delivered`.

## Safety boundary

This acceptance work does not authorize production deployments, database migrations, secret changes, paid upgrades, automatic merges, or live communications. Keep changes in a reviewable branch/PR. No Gen-X or Jarvis code may be imported, invoked, configured, or modified by the RyanAI Self-Patch subsystem.
