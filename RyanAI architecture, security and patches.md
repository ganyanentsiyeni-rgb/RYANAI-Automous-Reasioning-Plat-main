# RyanAI Architecture, Security and Patch Policy

**Documentation baseline:** 21 November 2026  
**Scope:** current architectural contracts and safe engineering changes. Source code, schema, migrations, workflow definitions, and service configuration remain authoritative.

## 1. Architecture and authority

RyanAI is a modular, human-governed platform. Its authority chain is:

**Human owner → Gen-X policy/authorization → Jarvis coordination → capability-scoped agents/tools → systems of record → evidence and memory.**

- Gen-X is the authorization authority; models cannot authorize themselves.
- Jarvis coordinates approved tasks but cannot grant permissions.
- Agents act only through authenticated, scoped server-side identities.
- Adapters validate inputs, enforce scopes, apply timeouts/idempotency, and emit audit evidence.
- Humans approve privileged, irreversible, financial, production, and externally consequential actions according to policy.

## 2. Runtime and deployment topology

The release CI topology has four independently verified areas:

1. **Railway — primary gate** and persistent-workload target.
2. **Render** — independent build/deployment target for configured web/API services.
3. **Vercel** — independent build/deployment target for configured backend functions/routes.
4. **MCP and MCP servers** — independent build, authentication, tool-discovery, delegation, and health target.

The exact service-to-provider mapping must be checked against current workflow and provider configuration. No source document alone proves a live deployment. Require exact commit, workflow/job result, provider deployment ID, and runtime health evidence. A green build on one provider does not clear another provider's gate.

## 3. Core data and migration ownership

## 2.5 Shared PA / Darkside / Admin / Comms control plane

PA Agent and Darkside Copilot use the same governed responsibility and capability model, with the Admin Console providing an administrative view of that control plane. Their shared capability surface includes internal Comms task creation and governed deployment orchestration. UI selection is never authorization; server-side owner scope and Gen-X remain authoritative.

A deployment request is explicit: `PUSH DEPLOY`. The release workflow must validate the exact candidate SHA, confirm current `main`, and require every named CI/CD/security check for that exact SHA to pass before any provider job begins. Render, Railway, and Vercel then execute independently and each reports deployment identity, source SHA, provider status, and runtime health. A provider failure does not silently cancel the other provider jobs.

The PA execution receipt distinguishes workflow-dispatch acceptance from provider completion. A queued deployment receipt is never treated as a successful deployment. The durable internal Comms child task receives the per-provider outcome for reporting; it does not imply outbound delivery.



- PostgreSQL is authoritative application persistence; pgvector supports vector retrieval.
- Redis/Valkey is used for supported cache/queue workloads, not as the authoritative record of business state.
- Supabase owns Supabase platform objects, Auth-linked data, Storage policies, and Supabase-specific migration history.
- Prisma owns application objects represented by the Prisma schema and its migration history.
- A Prisma mapping of a Supabase-owned table does not transfer migration ownership.
- Keep audiobook persistence separately scoped as specified by its current staging contract.
- Never use `db push`, production reset, or edited historical migrations as a schema-repair shortcut.

## 4. AgentRun, Comms, and delivery semantics

- AgentRun is the durable execution lifecycle for a task.
- Inbound Comms admission is durable and idempotent.
- An `in_flight` crash is an uncertain outcome until reconciled against provider evidence; do not blindly replay a potentially accepted request.
- Outbound dispatch is a distinct delivery workflow.
- Provider callbacks create append-only delivery receipts and update dispatch projections.
- Delivery status must not overwrite AgentRun execution state or rewrite a message's execution lifecycle.
- Callback acceptance requires signature verification, freshness/replay controls, provider identity, and correlation to a known dispatch.
- Duplicate callbacks are idempotent; unknown or cross-owner callbacks are rejected and audited.

## 5. Security baseline

### Identity and access
- Authenticate every user, service, agent, worker, device, and MCP caller.
- Enforce owner/tenant isolation server-side; never trust client-supplied owner IDs.
- Use least-privilege scopes, short-lived credentials, and deny-by-default policy.
- Keep approval decisions separate from the agent that proposes or executes work.

### Secrets and transport
- Store secrets only in protected runtime settings or an approved secret manager.
- Never commit credentials, tokens, private keys, connection strings, or secret-bearing logs.
- Never put provider secrets in `VITE_*` variables or browser bundles.
- Preserve TLS certificate verification. Do not use insecure TLS bypasses as a workaround.

### Comms and privacy
- Validate provider webhook signatures and replay windows.
- Verify owner and destination before a live test.
- Keep message content and personal identifiers out of routine logs.
- Live WhatsApp/SMS/voice/email requires explicit test authorization and provider callback evidence.
- A configured provider, accepted API request, or queued dispatch is not proof of delivery.

### Infrastructure and data
- Isolate agent sandboxes; do not mount developer home directories or production data.
- Use synthetic/sanitized staging fixtures.
- Production deployment, database migration, secret mutation, paid upgrades, and infrastructure mutation each require separate explicit owner approval.

## 6. Patch protocol

1. Record objective, acceptance criteria, non-goals, risk, and rollback.
2. Inspect exact base SHA, owning source, tests, schema, and workflows.
3. Reproduce the issue and add a regression test.
4. Make a focused change on a dedicated branch.
5. Validate migration ownership and compatibility before schema edits.
6. Run relevant tests, typechecks, builds, and security scans; record exact outcomes.
7. Inspect the complete diff for scope, secret leakage, authorization gaps, and unintended behavior.
8. Open a PR with base/head SHA, changed files, evidence, risks, and rollback.
9. Obtain human review and required checks; do not auto-merge or bypass.
10. Deploy only through the separately approved CI/release process.

## 7. Patch classes and approval boundaries

| Patch class | Examples | Approval boundary |
|---|---|---|
| Documentation-only | README, runbooks, architecture notes | PR review and CI; no runtime mutation |
| Application repair | API/UI/agent logic, regression tests | PR review and required CI/security |
| Schema/migration | Prisma/Supabase schema or migration | Separate production migration approval |
| Secret/provider | Tokens, keys, sender configuration | Explicit secret/provider authorization |
| Infrastructure | service settings, networking, resources | Explicit infrastructure approval |
| Release/deployment | deploy, promote, rollback | Explicit production deployment approval |
| External communication | SMS, WhatsApp, voice, email | Verified callback + owner/destination + explicit test approval |

## 8. Current implementation caveat

This document is a contract and synthesis, not a certification. It does not assert that every provider is connected, every CI job is green, every callback is configured, every service is deployed, or every security control is runtime-verified. Consult exact-head workflow evidence, provider records, health probes, migration ledgers, and source tests.
