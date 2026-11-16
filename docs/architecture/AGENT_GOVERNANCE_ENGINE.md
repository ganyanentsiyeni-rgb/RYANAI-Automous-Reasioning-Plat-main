# RyanAI Agent Governance Engine

**Status:** Phase 1 policy and MCP tool-governance contract. This change does not claim durable audit storage, SIEM delivery, runtime agent-profile binding, a new approval service, sandbox isolation, or production activation.

## Objective

Make agent capabilities explicit, deny-by-default, least-privilege, and reviewable without replacing GitHub or the existing RyanAI deployment architecture.

## Existing controls retained

- MCP tools remain disabled unless explicitly named in `RYANAI_MCP_ENABLED_TOOLS`; the read-only registry is always available.
- HTTP MCP calls require a short-lived API-issued delegated identity.
- Delegated tool calls are re-authorised by the RyanAI API at execution time.
- Gen-X remains the independent authorization authority. Model output cannot create permissions.
- Communications MCP prepares drafts only. It does not dispatch messages or place calls.

## Phase 1 implementation

- Add capability, risk, execution, approval, audit, production-access, and secret-access metadata to every registered MCP tool.
- Add a machine-readable governance policy describing Jarvis engineering and reasoning-specialist boundaries; profile-to-identity enforcement remains a later phase.
- Validate the policy against the live MCP tool registry so capability drift and unregistered tools fail CI.
- Add regression tests for deny-by-default, authority separation, audit privacy, and tool-policy consistency.

## Authority and approval boundaries

| Action | Agent authority |
| --- | --- |
| Read explicitly allowlisted repository status, stack metadata, or health | Permitted within delegated scope |
| Run project checks | Operator allowlist in the trusted local stdio runtime; no production access or secrets. Not granted by the current HTTP delegation scopes; not sandbox-isolated |
| Request configured model reasoning | Local stdio only, operator allowlist plus explicit user-requested task and approved provider route |
| Prepare a communications draft | Local stdio only; permitted only as a draft. Human approval remains mandatory before dispatch |
| Read secrets or change credentials | Denied |
| Change agent permissions or policy | Denied |
| Merge a pull request or deploy production | Denied |
| Apply production database migrations | Denied |

## Audit and observability status

The policy defines the minimum audit metadata contract: actor, agent, tool, capability, decision, approval reference, resource class, outcome, timestamp, and correlation ID. Secret values and raw prompts/tool payloads must not be recorded.

**Durable audit persistence and SIEM streaming are explicitly NOT IMPLEMENTED by this phase.** They require a separately reviewed storage/retention design and must not be inferred from registry metadata or a passing policy test.

## Verification

Run:

```sh
npm run agent-governance:validate
npm run test:agent-governance
npm --prefix mcp-server run check
```

The checks are static policy/contract tests. The new agent-profile matrix is not yet bound to runtime identities. The current HTTP delegation map does not grant project-check, reasoning, or communications tools. These checks do not prove hosted MCP connectivity, live identity issuance, provider health, sandbox isolation, or production readiness.

## Rollout

This phase changes source code and CI validation only. It does not change environment variables, create credentials, alter infrastructure, run migrations, enable tools, or deploy services. Keep the PR subject to exact-head CI/security checks and human review.
