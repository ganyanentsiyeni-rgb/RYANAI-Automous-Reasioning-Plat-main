# RyanAI Self-Patch: CI/CD and GitHub Operations

## Scope

This subsystem owns only the RyanAI application repository and its own CI/CD workflows. Gen-X and Jarvis are explicitly out of scope: do not inspect, invoke, change, configure, authorize, or report on either system. Existing unrelated repository workflows are not authority to expand this subsystem's scope.

## Operating lifecycle

1. Discover repository workflows, latest run summaries, exact-head checks and deployment-environment names.
2. Classify every check as passed, failed, queued, in progress, cancelled, skipped or missing. Only an exact successful check is passed.
3. Diagnose failures using job/step evidence and preserve the triggering commit SHA and workflow/run identifiers.
4. Produce a minimal patch proposal with impact, tests, security implications and rollback notes.
5. Request explicit owner approval before any write action.
6. Apply only the approved change on a dedicated branch and open a reviewable PR.
7. Require CI/security checks and human review. Never auto-merge.
8. Report the verified PR head SHA and exact check evidence.

## Hard execution boundaries

- Audit jobs are read-only and use least-privilege GitHub token permissions.
- No workflow dispatch or rerun by the monitor.
- No production deployment, database migration, infrastructure mutation, paid upgrade, secret creation/update/rotation, or credential disclosure.
- No raw GitHub, Render, Vercel or Railway secret values. Environment inventory reports names/presence only.
- Never treat queued, skipped, cancelled, missing, provider-blocked or unavailable evidence as success.
- A repair PR is not a deployment authorization.

## Environment coverage

The audit enumerates GitHub Actions workflows and GitHub deployment-environment names. Runtime configuration is represented as presence-only metadata. Render, Vercel and Railway require their respective authenticated read-only integration adapters to inspect provider-side environment-variable names and deployment health. Provider secret values are never fetched.

## PA Agent and Comms integration gate

The existing PA observer implementation imports Gen-X policy code, and the existing Comms authorization path also invokes Gen-X policy. This RyanAI-only subsystem must not call those policy paths or modify Gen-X. Therefore this initial implementation deliberately publishes a machine-readable audit artifact and does not dispatch outbound messages.

Completing the PA Agent and Comms bridge requires a separate RyanAI-owned adapter boundary that:
- accepts signed, schema-validated audit events from this subsystem;
- exposes approval requests and status to PA Agent without importing Gen-X/Jarvis;
- queues Comms notifications through an owner-approved, verified-destination flow;
- keeps provider callbacks and delivery receipts as the only evidence of successful delivery;
- never sends a live WhatsApp/SMS/voice/email message without separate test authorization and verified owner destination.

Until that adapter is reviewed, the report artifact is the durable handoff; no delivery is claimed.

## Current implementation

- `scripts/ryanai-self-patch-audit.mjs`: read-only GitHub Actions/check/environment inventory.
- `scripts/ryanai-self-patch-audit.test.mjs`: check-state and secret-redaction contract tests.
- `.github/workflows/ryanai-self-patch-audit.yml`: scheduled and manually dispatchable audit with read-only permissions.

The existing `workflow:agent:fix` command is not an autonomous repair engine. It currently runs validation and prints guidance; it does not implement patch application. Do not represent it as a working repair executor.
