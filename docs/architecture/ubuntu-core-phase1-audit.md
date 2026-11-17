# Ubuntu Core — Phase 1 Repository Audit

**Audit status:** Initial read-only source/configuration review  
**Repository:** `ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main`  
**Base commit:** `8a5b53917f7edae76c8ab9d8641d95190ca99800`  
**Scope:** Repository manifests, API entrypoints, authentication, authorization, device bridge, approval paths, and CI evidence.  
**Not covered:** Live Render/Railway host inspection, live production configuration, provider account state, database contents, or a full dynamic penetration test.

This is an evidence-based repository audit, not a declaration that the platform is production-ready. No application code, infrastructure, database, secrets, or deployment settings were changed.

## Executive summary

RyanAI has meaningful application-layer foundations: Fastify, Supabase user verification, Gen-X policy evaluation, short-lived MCP delegation, scoped PhoneLink device sessions, containerized services, and controlled migration workflows.

However, the approved Hybrid OS design must distinguish the intended operating model from the deployed hosting reality:

- Render and Railway are managed hosting platforms; the repository does not establish operator control of their underlying host OS.
- The checked-in API Dockerfiles use `node:24-alpine`. This is the container OS userspace, not an Ubuntu LTS host.
- Ubuntu LTS is therefore a future operator-managed host baseline, while CORE is currently a logical trust zone across provider-managed services.
- Kali lab isolation and Raspberry Pi OS deployment are design targets, not verified deployed environments.
- Authorization and approval paths need a route-by-route exact-action audit before any privileged execution expansion.

## 1. Runtime and OS mapping

| Area | Repository evidence | Assessment |
|---|---|---|
| API runtime | `src/server/launcher.ts`, `Dockerfile.api` | Fastify API; Node 24 Alpine container |
| Web runtime | `render.yaml`, root `Dockerfile` | Render static site is declared; container web target also exists |
| Render services | `render.yaml` | Blueprint declares web, API Docker service, and Redis |
| Railway | `railway.json` | Dockerfile.api build and `/health` health check are configured |
| Local stack | `docker-compose.yml` | PostgreSQL/pgvector, Redis, API, MCP and web services; migrations are opt-in |
| Ubuntu LTS host | No host provisioning or Ubuntu host image evidence found in reviewed manifests | Not implemented/verified |
| Kali Security Zone | Architecture documentation only | Isolated lab deployment not evidenced |
| Raspberry Pi OS | PhoneLink device APIs exist; no Pi OS image/deployment evidence found | Edge application groundwork exists; Pi OS rollout not evidenced |

**Architecture decision:** keep Ubuntu LTS as the host baseline for a future operator-managed environment. Do not rewrite the current application container to Ubuntu or claim the managed PaaS host is Ubuntu without an approved reason and platform evidence. A provider-managed host and a container base image are separate layers.

## 2. Identity and authorization foundations

### Verified foundations

- `src/server/routes/auth.ts` verifies bearer sessions with Supabase Auth `getUser`; it does not accept a merely decoded browser token as proof of identity.
- Admin role is derived from Supabase `app_metadata`; owner status is separately matched against the configured owner email.
- The global Fastify pre-validation hook applies route-family rules and falls back to administrator authentication for routes not explicitly classified.
- PhoneLink pairing uses random one-time codes stored as SHA-256 digests; device sessions are random bearer tokens stored as digests, capability-scoped, and revocable.
- MCP delegation requires a service token and short-lived signed user delegation. The API re-checks the delegated scope and Gen-X policy at execution time.
- `governance/agent-governance-policy.json` explicitly distinguishes policy contracts from runtime enforcement and marks agent-profile binding as contract-only.

### Gaps requiring focused repair/review

1. **Legacy authentication module:** `src/auth/authGateway.ts` contains a separate legacy auth implementation with unsafe fallback credential/JWT configuration and a non-cryptographic OTP generator. It is not imported by the main launcher examined in this audit. Complete a full repository reference/build audit, then remove or quarantine it in a dedicated repair PR. Do not copy or reuse its fallback values.
2. **Gen-X decision handling:** `governance/agent-governance-policy.json` declares `default_decision: DENY`, but `evaluateGenXSecurityEvent` returns `REQUIRE_APPROVAL` for unknown actions and many mutating/network actions. Some callers only reject `DENY`. Each caller must be classified as (a) create a pending approval, (b) deny, or (c) execute only after a verified approval receipt. A non-DENY result must never be treated as direct execution permission; the policy contract and evaluator semantics must be reconciled.
3. **Capability mismatch:** the PA capability map labels `tests.run` as `EXECUTE`, while Gen-X currently denies all `EXECUTE` actions. This capability cannot be granted through the present mapping and needs an explicit policy/design decision.
4. **Profile enforcement:** the governance document says agent-profile capability mapping is a validated contract, not a runtime identity-to-profile binding. Do not claim profile-level enforcement is live.
5. **Audit persistence:** the governance policy marks general audit persistence and SIEM streaming as not implemented in that policy phase. Specific tables/events exist in some flows, but that does not prove a complete durable audit/evidence system across all execution paths.

## 3. Approval and consequential execution

| Entry point | Existing control | Required follow-up |
|---|---|---|
| Pending action routes | Admin-only route hook; action claim uses a conditional one-time state update; args are parsed again before dispatch | Bind approval to immutable action digest, requester, target, arguments, expiry and approver; verify the digest again at execution |
| LangGraph approval routes | Admin-only route hook; resumes a paused graph using a thread ID | Persist an approval receipt for the exact pending tool call and arguments; bind requester, approver, policy version and one-time execution |
| Slack interactions | Slack HMAC and timestamp/replay-window verification | Add an explicit authorized Slack user/team/channel policy; payload username is display data, not an authorization identity |
| PA delegation | User-scoped delegation records and Gen-X policy evaluation; owner can approve their own delegation | Clarify which actions permit same-owner approval and which require an independent second human; bind the exact capability set and task digest |
| Provider communications | Agent tools include policy lookup and draft preparation; provider sends are outside those draft tools | Keep live dispatch disabled until callback verification, destination/owner verification, explicit test authorization and durable evidence are demonstrated |

The current approval paths are not interchangeable. An administrator-only endpoint, signed Slack request, pending-action ID, or graph thread ID does not by itself prove that a human approved the exact immutable action that will execute.

## 4. Edge/device readiness

PhoneLink already provides useful groundwork: authenticated account pairing, one-time pairing/exchange codes, hashed device bearer tokens, a capability allowlist, device ownership checks, and revocation.

That does **not** establish a Raspberry Pi OS deployment or hardware-rooted device identity. The next edge audit must verify device model/OS inventory, secure enrollment, certificate or equivalent device identity, revocation propagation, restricted gateway access, offline replay protection, and physical recovery. Do not infer mTLS, secure boot, or hardware-backed keys from the current PhoneLink bearer-token implementation.

## 5. CI evidence observed on the Hybrid OS documentation PR

The documentation PR head was `7888e11f5a3e53cdee5d659679ab7290dd678120`.

| Workflow | Observed result | Notes |
|---|---|---|
| CodeQL Security Analysis | Passed | Run 44157239439 |
| AI Inspector & Audit | Passed | Run 44157239056 |
| Security - Scan and Audit | Passed | Run 44157239271 |
| Secret Scanning (TruffleHog) | Passed | Run 44157239064 |
| Disposable Prisma/pgvector upgrade test | Passed | Run 44157239420 |
| CI build/test | Failed | Two lint errors were subsequently addressed by PR #111 |
| Agent API Regression Tests | Failed | Multiple existing test mismatches/timeouts; rerun on current main required |
| Database Schema Validation | In progress at last observation | No pass claim |
| Human PR Approval Gate | Failed | No current independent GitHub approval was found for PR #110 at check time |

PR #111 subsequently fixed the two lint errors and merged as commit `8a5b53917f7edae76c8ab9d8641d95190ca99800`. The other failed/in-progress checks above must be rerun on the current main before being treated as current status. PR #110 was merged despite its recorded human-approval workflow failure; confirm that repository rules actually enforce required review and checks for future PRs. A comment expressing approval is not the same as a GitHub `APPROVED` review state.

## 6. Main ruleset and merge enforcement

The active repository ruleset was inspected through the GitHub repository rulesets API:

- Ruleset ID: `27357206`, name `main-protection`, enforcement `active`.
- Pull requests require one approving review; stale approvals are dismissed on push; code-owner review, last-push approval, and review-thread resolution are enabled.
- Deletion protection and required linear history are enabled.
- **No required status-check rule is present** in the returned rules array.
- **No explicit non-fast-forward/force-push protection rule is present** in the returned rules array.
- The ruleset has multiple bypass actors with `always` bypass mode, including repository roles and integrations. The API reports `current_user_can_bypass: always`.
- The direct branch-protection endpoint returned HTTP 403 to the connected integration, so classic branch-protection settings could not be independently inspected.

This configuration does not meet the intended governance baseline. In particular, active CI/security checks are not represented as required rules in this ruleset, and bypass remains enabled. The failed Human PR Approval Gate recorded for PR #110 did not prevent that PR from merging, which is consistent with the missing required-status-check rule and the presence of bypass actors; the precise merge path cannot be established from this read-only audit alone.

**Required governance repair:** configure a ruleset that requires the designated CI, application, database, and security checks; prevents force-push and branch deletion; requires independent human approval and resolved conversations; and has no always-bypass actors, including integrations and administrators where supported. Verify the final ruleset through a fresh read after the owner applies the change. This audit did not mutate repository governance settings.

## 7. Prioritized Phase 1 actions

### P0 — Governance and evidence

- Repair ruleset `27357206`: required status checks are absent and multiple always-bypass actors remain.
- Ensure a failed human approval gate prevents merge; no admin/integration bypass or auto-merge.
- Verify force-push prevention, deletion prevention, independent review, and required check enforcement after the owner updates the ruleset.
- Re-run required CI/security workflows on current main and record exact SHA/run IDs.

### P1 — Authorization correctness

- Produce a route-by-route matrix for every externally reachable route and every consequential capability.
- Verify Slack actor authorization and exact-action approval binding.
- Bind approval records to immutable action digests and execution-time policy reauthorization.
- Resolve the Gen-X `REQUIRE_APPROVAL` caller semantics and `tests.run` capability mismatch.
- Quarantine the legacy auth module after a complete reference check.

### P2 — Platform and edge readiness

- Keep CORE as a logical trust zone on managed PaaS until an operator-managed Ubuntu host is separately approved.
- Validate the actual Render/Railway service source, commit and host configuration through read-only provider evidence.
- Complete the Raspberry Pi device identity, enrollment, gateway, revocation and offline-replay design.
- Prove backup restoration and independent recovery; backup completion alone is not acceptance.

## 8. Change boundary

This audit authorizes no code changes, merge, deployment, database mutation, secret changes, paid upgrades, host provisioning, hardware procurement, or live communication. Each remediation is a separate focused PR with tests, exact-head evidence, human review, and a rollback plan. Production actions require separate explicit approval.
