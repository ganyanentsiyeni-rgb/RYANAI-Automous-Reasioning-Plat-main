# RyanAI Worker Execution Contract

**Contract version:** 1  
**Implementation branch:** `feat/evo-04-worker-contracts`  
**Status:** First typed contract increment; not a worker runtime or authorization grant.

## Purpose

Give every engineering, security, governance and review worker the same auditable result envelope. A result is bound to a repository, branch and full commit SHA so evidence from an earlier head cannot be reused to claim that a newer revision passed.

## Required identity and provenance

Every result includes:
- task ID, agent ID and worker ID (agent identity and worker process identity remain distinct);
- repository in `owner/name` form;
- branch and full 40-character commit SHA;
- optional PR number, workflow run ID and job IDs;
- explicit status, summary, evidence, findings, recommendations and blockers;
- start time and, for terminal results, completion time.

## Status semantics

| Status | Meaning |
|---|---|
| `passed` | Work completed and required evidence is attached and verified. |
| `failed` | Work completed with a failure. |
| `queued` | Accepted but not started. |
| `running` | Execution is in progress. |
| `skipped` | Intentionally not executed. Never a pass. |
| `cancelled` | Execution was cancelled. Never a pass. |
| `missing` | Expected evidence or execution could not be found. |
| `provider_blocked` | An external provider prevented execution or verification. |
| `awaiting_approval` | Human or policy approval is required before proceeding. |

## Success rule

A result can claim success only when:
1. the contract is valid;
2. the full commit SHA and repository context are present;
3. at least one evidence reference is attached;
4. every evidence item is verified;
5. any evidence commit SHA matches the task head SHA;
6. findings refer only to evidence attached to the result.

The validator checks report structure. It does not verify GitHub itself, prove that a workflow is required, or authorize a merge. GitHub remains the source of truth for check conclusions and review state.

## Worker boundaries

- CI workers inspect workflow runs, jobs and logs.
- Security workers inspect CodeQL, dependency, container and secret-scan metadata without exposing secret values.
- Governance workers inspect review and required-check state.
- Review workers report code and test findings.
- No worker may merge its own PR, bypass branch protection, change secrets, deploy, migrate production or grant itself capabilities.

## Next implementation gates

This contract is a schema/validation foundation. Follow-on work must add adapters for GitHub workflow/check data, append-only result persistence, signed/verified evidence retrieval, worker scheduling and Gen-X capability checks. Those integrations remain incomplete until independently tested.
