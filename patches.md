# RyanAI Patch Record — Shared PA / Darkside / Comms / Push Deploy

**Status:** implementation record for the focused repair branch. This document records intended and implemented contract changes; it is not a deployment certification.

## 1. Scope

This patch aligns four connected responsibilities:

- **PA Agent** — governed task execution and deployment orchestration.
- **Darkside Copilot** — shared operator surface using the same PA capability model.
- **Admin Console** — administrative access to the shared PA control plane.
- **Comms** — durable internal child-task reporting from PA objectives.

## 2. Deployment contract

The release path is:

**exact candidate SHA → exact-SHA CI/CD + security gate → explicit PUSH DEPLOY → Render + Railway + Vercel independent jobs → per-provider deployment evidence → per-provider health verification → durable internal Comms report.**

A provider failure does not silently prevent the other provider jobs from being attempted.

A PA deployment receipt is only workflow-dispatch acceptance. It is not evidence that CI passed, a provider deployed, or runtime health passed.

## 3. Authorization

- UI capability selection is not authorization.
- Gen-X remains the authorization authority.
- deployment.execute is a governed capability.
- Deployment requests must include comms.task.create so the result can be reported internally.
- The explicit PUSH DEPLOY phrase is required for deployment requests.
- The fixed workflow validates the current main SHA and all required exact-SHA checks.
- No secret creation, rotation, or exposure is performed by this patch.
- No database migration is performed by Push Deploy.

## 4. Comms contract

A PA objective can create a durable internal Comms child task directly; an existing Comms conversation is not required.

The child is owner-scoped, idempotent, linked to the parent task, and internal-only. It does not send WhatsApp, SMS, voice, or email.

Future routing tags:

@RyanAI @PA Agents @Comms @Security @updates @self-patches

are routing metadata only. They are not authorization and must not bypass the explicit release gate.

## 5. Verification requirements

Before merge, record:

- exact branch/head SHA;
- CI typecheck/lint/test/build results;
- security scan results;
- workflow validation;
- PA capability/Gen-X tests;
- Comms child-task tests;
- deployment workflow validation;
- review result.

Do not convert queued, skipped, cancelled, missing, stale, or provider-blocked checks into a pass.

## 6. Deployment boundary

This patch does **not** trigger production deployment. Production deployment still requires the explicit Push Deploy action after the required exact-SHA checks pass.

## 7. AI Inspector module and worker handler coverage

- Added a dedicated `ai-inspector-module-agent` module owner with `ai-inspector.audit` and `ai-inspector.report` routing.
- Routed those task types to the repository-auditor profile, with read-repository capability checks and report output persisted through the Studio task completion boundary.
- Added bounded read-only specialist handlers for coordinator, security, runtime/infrastructure, data/queue, provider configuration, communications/identity, frontend/accessibility, and release readiness. The existing repository inventory and CI diagnostics handlers remain distinct.
- Updated the AI Inspector workflow to run the audit with `--write`, creating the report path that the artifact-upload step expects.
- Added registry and handler-readiness regression tests. These validate registration, not deployed/live heartbeats.
- No production deployment, database migration, secret change, auto-merge, or external message delivery.

## 8. Backend handler integrity repair

- Repaired the malformed specialist handler module introduced by overlapping edits: removed duplicate/truncated declarations and restored one complete static inspection and AI Inspector execution path.
- Preserved the dedicated AI Inspector module owner and PA direct inspection capability; specialist worker registration now exposes `ai-inspector.audit` and `ai-inspector.report` without replacing or double-registering repository inventory handlers.
- Bounded repository evidence traversal by root path, depth, file count, and file size; added cancellation checks and read-only behavior.
- Preserved high-severity AI Inspector findings for PA with report digest/source/exit-code evidence. Exit code 1 means findings exist; it must not discard the report or falsely claim a clean audit.
- Added a regression test for PA report delivery, alongside handler registration/routing tests.
- No deployment, migration, secret changes, paid upgrade, auto-merge, or outbound communications.

## AI Inspector module and PA report skills

- Allocated the dedicated `ai-inspector-module-agent` as the 13th module identity, with bounded read/inspect/test/evidence/patch-proposal actions and no privileged execution authority.
- Expanded its inspection path to combine `scripts/ai-inspector-audit.mjs` with bounded cross-module source inspection for agent orchestration, backend integrations, provider adapters, queue/lease contracts, infrastructure, CI workflows, and release documentation.
- PA receives structured findings, severity/rule IDs, evidence-file references, source metadata, report text, and a digest through durable AgentRun evidence. Exit code 1 retains high-severity findings for triage; it is not misreported as a clean audit.
- Corrected the pg-dump connection test contract to use Node's native test runner and excluded that file from Vitest discovery; CI continues to execute it explicitly with `node --test`.
- No secrets were changed, no production migration/deployment occurred, and no external communication was sent.
