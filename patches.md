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
