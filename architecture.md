# RyanAI Architecture — Shared PA, Darkside Copilot, Comms and Release Control Plane

**Status:** architecture addendum. Source code, workflow definitions, schema, provider records, and exact-head CI evidence remain authoritative.

## 1. Shared responsibility model

PA Agent and Darkside Copilot are two operator surfaces over the same governed PA responsibility and capability model. The Admin Console exposes administrative controls over that same model.

The UI does not grant authority. The server validates identity, owner scope, capability scope, and Gen-X policy before execution.

## 2. Comms integration

Comms is part of the shared control plane. A PA objective can create a new durable internal Comms child task directly from the objective; an existing Comms conversation is not a prerequisite.

The child task is:

- owner-scoped;
- idempotent;
- linked to the parent PA delegation;
- internal-only;
- suitable for status/result reporting.

It cannot be treated as proof of outbound delivery.

## 3. Release orchestration

The governed deployment sequence is:

1. PA or an authorized operator requests PUSH DEPLOY.
2. The release request identifies the exact 40-character candidate SHA.
3. The workflow confirms that SHA is the current main commit.
4. All required CI/CD and security checks for that exact SHA must complete successfully.
5. Only then do the Render, Railway, and Vercel jobs start.
6. The three provider jobs are independent.
7. Each provider records deployment identity/status, source SHA, and runtime health.
8. The durable internal Comms task reports the separate outcomes.

One provider's result never substitutes for another provider's result.

## 4. Provider independence

Render, Railway, and Vercel are mandatory release targets for this control plane. A failure or provider block is reported against that provider while the other provider jobs remain independently eligible after the common gate.

The overall release is successful only when all required provider deployment and health checks succeed.

## 5. Comms message routing

The future routing tags @RyanAI, @PA Agents, @Comms, @Security, @updates, and @self-patches identify routing intent only.

A message-trigger adapter must still enforce authentication, owner scope, idempotency, exact-SHA resolution, the explicit PUSH DEPLOY command, and the same CI/security gate. Until that adapter is implemented and verified, tagged messages must not be interpreted as deployment authorization.

## 6. Evidence and safety

A workflow-dispatch receipt means only that GitHub accepted the workflow request. It does not mean CI passed or deployment completed.

Evidence must distinguish:

passed / failed / queued / skipped / cancelled / missing / provider-blocked.

No production deployment, production migration, secret mutation, paid upgrade, or external communication is authorized by this document.

## 7. AI Inspector and specialist handlers

The AI Inspector has a dedicated module owner, `ai-inspector-module-agent`, and task types `ai-inspector.audit` and `ai-inspector.report`. PA can route inspection objectives to the repository-auditor specialist. The Inspector returns structured, evidence-file-linked findings as the durable Studio task output; the CI workflow separately writes `reports/ai-inspector-audit.md` and uploads it as an artifact.

The specialist worker process registers bounded handlers per profile. Security, infrastructure, data/queue, provider, communications, frontend/accessibility, and release handlers perform read-only static inspections. Provider configuration presence is never represented as live provider health. Runtime verification remains `not_performed` unless independently supported by fresh runtime evidence. The coordinator proposes a plan only; it has no execution authority.

The 13 module agents and 10 specialist worker profiles are registry contracts, not live-runtime assertions. A worker is live only when a real process has a fresh healthy persisted heartbeat and its task/lease execution evidence is available. CI diagnostics remains bound to connected GitHub workflow evidence. No handler can approve, merge, deploy, migrate production, mutate secrets, or send external communications.
