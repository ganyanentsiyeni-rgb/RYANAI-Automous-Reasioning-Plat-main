# RyanAI Mission Operating UI — Implementation Boundary

**Status:** UI hardening increment complete; live backend integration remains contract-gated  
**Branch:** `feat/ryanai-mission-operating-ui-20261117`  
**Route:** `#/architecture`  
**Scope:** Frontend navigation and interactive architecture presentation only

## What this increment adds

- A dedicated, authenticated Mission Architecture workspace integrated into the existing React application shell.
- Four interactive architecture-plane views: Control, Intelligence, Execution, and Evidence.
- A selectable map of all twelve target architecture domains.
- A workspace directory covering Command Center, Operator Console, Admin Console, Cockpit, RyanAI Studio, Quant Lab, Audiobook Studio, Comms, PhoneLink, Memory Vault, GitHub Integration, and Inference Console.
- A Gen-X execution-gate presentation and explicit boundaries for production, database, secrets, infrastructure, communications, trading, and merge operations.
- A hybrid responsive visual system: dark operational command surface with light information-dense architecture/workspace panels.

## Architecture mapping

| Domain | UI representation in this increment |
|---|---|
| Mission & Experience | Mission-to-outcome flow and workspace map |
| Identity & Governance | Gen-X policy and execution-gate view |
| Ontology & Context | Domain map and semantic-plane placement |
| Intelligence Fabric | Intelligence plane and Inference Console workspace |
| Agent Orchestration | Jarvis coordination model |
| Execution Fabric | Capability-adapter and execution-gate model |
| Memory & Knowledge | Memory Vault workspace and governed retention boundary |
| Data Foundation | PostgreSQL, Prisma, pgvector, Redis and object-storage concepts |
| Evidence & Observability | Evidence plane, verification and receipt model |
| Application Workspaces | Twelve-workspace directory |
| Infrastructure & Delivery | Render/Railway and CI-delivery architecture description |
| Learning & Optimization | Evaluation and benchmark domain |

## Authority and security contract

- Gen-X remains the policy decision authority. The UI does not issue authorization decisions.
- Jarvis is presented as a bounded coordinator. It cannot grant permissions, approve its own work, or bypass policy.
- Models are reasoning components, not permission authorities.
- Capability adapters must independently enforce current server-side policy and approval immediately before consequential execution.
- Human approval is bound to the exact action/resource/context when policy requires it.
- The UI is not an authorization boundary. Existing backend identity, owner/admin checks and route restrictions remain authoritative.
- Unknown or unavailable policy state must fail closed for consequential actions.
- Production deployment, production database migration, secret changes, paid upgrades, production infrastructure changes, outbound communications, live trading and automatic merge remain outside this increment and retain their separate approval gates.
- No schema, migration, credential, environment variable, provider activation or infrastructure change is included.

## Current implementation boundary

The architecture workspace remains a deliberately non-authoritative architecture surface: it does not fabricate live health, queue, approval, deployment or test statuses. The UI hardening increment now covers keyboard-focus visibility, responsive navigation behavior, explicit preview/live-state labeling, and protected workspace access presentation. Admin settings now distinguish owner-only Comms from administrator-accessible workspaces, and stale capability copy has been removed where protected APIs already exist.

Live mission, ontology, Gen-X decision, Jarvis queue, model registry, capability invocation, evidence-ledger and Memory Vault telemetry must be connected only through existing authenticated contracts. Before adding endpoints or persistence, reconcile existing API routes, Gen-X policy services, Jarvis orchestration, Prisma/Supabase ownership, current migrations, and existing evidence/memory implementations. Do not create parallel tables or shadow authorization services.

## Validation required before merge

- CI must run against the exact pull-request head SHA.
- Require lint, application typecheck, tests, build, and applicable security checks.
- Review the mobile navigation, keyboard focus, accessibility semantics, route authentication, role restrictions, and disabled-workspace behavior. The current UI increment includes explicit non-interactive states for inaccessible privileged workspaces and visible focus rings for architecture controls.
- Verify no existing route behavior or user preferences regress.
- Treat queued, skipped, cancelled, missing, or provider-blocked checks as non-passing.
- Human review is required. Do not auto-merge.

## Delivery boundary

This PR is documentation and frontend-only. It does not authorize production deployment, production database work, provider calls, live communication, infrastructure changes, secret operations, paid upgrades, or auto-merge. A later production release requires separate explicit approval.


## Agent UI approval dialog accessibility follow-up (2026-11-28)

The app-owned Agent UI approval dialog now places initial focus on Decline, contains keyboard Tab navigation, maps Escape to decline, restores focus to the invoking control after dismissal, and programmatically associates the approval summary with the dialog. These are interaction and accessibility safeguards only: the server remains authoritative for authorization, and approving the UI prompt does not grant server permissions. Regression tests cover initial focus, Escape dismissal, and focus restoration. Exact-head CI and security validation are still required before release.
