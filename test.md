# RyanAI Test and Verification Plan

**Baseline:** 21 November 2026  
**Purpose:** define the evidence required to call a code change, integration, or release verified.

## 1. Test layers

| Layer | What it proves | Does not prove |
|---|---|---|
| Static analysis / typecheck | Source conforms to configured static rules | Runtime correctness |
| Unit tests | Isolated behavior for covered cases | Database/provider integration |
| Contract tests | API, event, schema, and adapter compatibility | External provider delivery |
| Integration tests | Components work together against controlled dependencies | Production readiness |
| Migration validation | Migration chain applies to the intended disposable/staging target | Production migration approval |
| Security checks | Specific scanned risks were not found by the executed checks | Absence of all vulnerabilities |
| Build / image tests | Artifact can be produced | Deployment or health |
| Deployment check | Provider accepted and deployed a specific artifact | Functional end-to-end behavior |
| Runtime smoke / health | Target responds to defined probes | Full product acceptance |

## 2. Comms and AgentRun regression matrix

Required coverage for inbound admission and delivery lifecycle:

- Duplicate inbound provider event returns the original admission/result and does not create duplicate execution.
- Concurrent duplicate admission is serialized by the durable uniqueness/idempotency boundary.
- Worker crash before admission commit does not leave a phantom accepted operation.
- Worker crash while `in_flight` enters an explicit uncertain/reconciliation path; it is not blindly replayed as safe.
- Provider reconciliation can resolve accepted, rejected, delivered, undelivered, or still-unknown outcomes without fabricating certainty.
- AgentRun state and outbound dispatch state remain separate.
- Delivery callbacks append a receipt and update dispatch projection without rewriting message/AgentRun execution state.
- Duplicate callbacks are idempotent and do not create duplicate receipts.
- Invalid signatures, stale timestamps, replayed callbacks, unknown dispatch IDs, and cross-owner callbacks are rejected.
- Callback processing does not expose message body, phone number, email, auth token, or other sensitive values in logs.
- Cancellation, retry, timeout, and terminal-state transitions are covered.

## 3. Database and migration validation

- Identify the owning migration system before changing schema: Prisma or Supabase.
- Validate migration history and schema from a clean disposable database or isolated staging branch.
- Test upgrade from the actual committed predecessor, not only a freshly generated schema.
- Confirm foreign keys, indexes, constraints, RLS/grants, and rollback/forward-recovery behavior as applicable.
- Keep Prisma and Supabase migration ledgers separate and execute in documented order.
- Never use production data in fixtures. Never use `db push`, reset, or rewritten historical migrations to mask drift.
- Production migrations require separate explicit approval and evidence of successful staging validation.

## 4. CI / deployment matrix

Required provider targets:

| Target | Required evidence |
|---|---|
| Railway — primary gate | Exact SHA build/test/security results; deployment ID; service health and smoke evidence |
| Render | Exact SHA build/test/security results; deployment ID; API/web health and smoke evidence |
| Vercel | Exact SHA build/test/security results; deployment ID/URL; backend function or route smoke evidence |
| MCP / MCP servers | Build and security checks; authenticated discovery; delegated API call contract; health and authorization-denial tests |

The exact service mapping, workflow names, required jobs, and environment are determined by current repository configuration. Do not invent them.

## 5. CI status vocabulary

- **Passed:** terminal successful result on the exact candidate SHA.
- **Failed:** terminal unsuccessful result; record failing job and logs.
- **Queued / in progress:** not a pass.
- **Skipped:** not a pass unless explicitly documented as not applicable and accepted by policy.
- **Cancelled:** not a pass.
- **Missing:** no evidence was found.
- **Provider-blocked:** external quota, permission, outage, or provider limitation; not a pass.
- **Deployed:** provider confirms deployment of the exact artifact/commit.
- **Runtime-verified:** required health and smoke checks passed against that deployment.

## 6. Release acceptance

A release candidate is eligible for human review only when:
1. Scope and acceptance criteria are met.
2. Regression tests and required static/security checks pass on the exact head SHA.
3. Database changes are validated against the correct migration history and staging target.
4. All required provider target checks reach terminal passing states.
5. Deployment records identify the exact commit/artifact.
6. Runtime health and smoke checks pass.
7. No unresolved critical security or data-integrity issue remains.
8. Human review is complete.

Merge and deployment remain separate approval events. No auto-merge, bypass, or production action is implied by a green test suite.
