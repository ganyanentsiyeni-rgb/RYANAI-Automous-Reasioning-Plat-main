# RyanAI Agent Operating Guide

**Status:** repository operating guidance, 21 November 2026  
**Applies to:** Jarvis, RyanAI agents, PA agents, Comms agents, MCP tools, coding agents, and delegated workers.

## 1. Authority model

- **Gen-X** is the policy and authorization authority.
- **Jarvis** coordinates approved work; coordination is not permission.
- **Agents** reason, plan, and execute only capabilities granted to their authenticated server-side identity and task.
- **Tools** enforce schemas, scopes, validation, timeouts, idempotency, and audit requirements.
- **Humans** retain approval authority for privileged or externally consequential actions.
- **Evidence** is the source of truth for completion.

No model or agent may grant itself permission, approve its own privileged action, bypass Gen-X, or infer authorization from a prior unrelated approval.

## 2. Task lifecycle

1. Receive an authenticated request with objective, scope, acceptance criteria, and constraints.
2. Validate identity, tenant/owner scope, input schema, and prohibited credential material.
3. Ask Gen-X to evaluate capability, policy, risk, and approval requirements.
4. Create or resume a durable AgentRun with a stable idempotency key.
5. Execute through the least-privilege approved tool adapter.
6. Persist lifecycle events, handoffs, results, errors, and provenance.
7. Return a truthful terminal or waiting state: `queued`, `running`, `waiting_for_approval`, `blocked`, `succeeded`, `failed`, or `cancelled`.
8. Preserve audit/evidence receipts and require human review where policy says so.

A queued job is not running; a running job is not complete; a provider-accepted request is not delivered; a successful unit test is not production readiness.

## 3. Comms and PA agent contract

- PA agents and Comms workers operate through AgentRuns and the same authorization, idempotency, audit, and approval boundaries.
- Inbound admission is durable and idempotent. A crash while `in_flight` requires explicit uncertainty handling and provider reconciliation before any retry that could duplicate work.
- Separate AgentRun execution state from outbound dispatch state and provider delivery receipts. Delivery receipts are append-only evidence; callbacks must not overwrite execution state.
- Verify webhook signatures and correlate callbacks to a known durable dispatch. Reject unmatched, malformed, replayed, or out-of-scope callbacks safely.
- Never claim a message/call/email was delivered without a provider callback or equivalent authoritative receipt.
- Live WhatsApp, SMS, voice, and email require provider configuration, valid callback verification, verified owner and destination, and explicit test authorization.

## 4. Repository and engineering work

- Read `AGENTS.md`, the owning architecture document, source, tests, migrations, and current exact base SHA.
- Work on a focused branch; do not commit directly to `main`.
- Reproduce bugs and add regression tests. Keep code, migrations, secrets, infrastructure, and deployment changes separated.
- Open a PR with scope, acceptance criteria, exact evidence, risks, and rollback notes.
- Require human review and all required CI/security checks. No auto-merge, bypass, or self-approval.

## 5. Deployment and data boundaries

The release topology requires CI evidence for Railway (primary gate), Render, Vercel, and MCP/MCP servers. Inspect current workflows and service configuration for the exact service-to-provider mapping. A workflow definition or green build does not prove a deployment. Require exact-head terminal results, deployment identifiers, and runtime health evidence.

No production deployment, production migration, secret mutation, paid upgrade, or production infrastructure change without separate explicit owner approval. Use staging/synthetic data and the correct migration owner. Never disable TLS verification.

## 6. Required handoff

Every completed task reports:
- repository, branch, base SHA, head SHA, and PR URL;
- changed files and concise behavior summary;
- tests/checks actually run and exact outcomes;
- deployment/runtime evidence, if separately authorized;
- blockers, residual risks, rollback, and next owner action.

Do not fabricate evidence or present unknown, skipped, queued, cancelled, or provider-blocked work as passed.
