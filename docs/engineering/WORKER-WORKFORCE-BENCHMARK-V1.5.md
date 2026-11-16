# RyanAI Worker Workforce Benchmark v1.5

**Type:** isolated engineering benchmark  
**Branch:** `feat/worker-workforce-benchmark-v1.5`  
**Execution mode:** deterministic, local, synthetic fixtures only  
**Production impact:** none

## Assignment

Jarvis coordinates this benchmark. The shared workforce is assigned as follows:

| Worker | Benchmark assignment | Required evidence |
|---|---|---|
| Coordinator | Verify task ownership, deterministic routing, and fail-closed handling | Routing assertions |
| Repository Auditor | Verify both workforce registries and declared counts | Roster and uniqueness assertions |
| CI Diagnostics | Run and classify the focused benchmark test | Exact test command and result |
| Security Auditor | Check that registry capabilities do not grant privileged side effects | Forbidden-capability assertions |
| Runtime and Infrastructure | Confirm the test is local and does not require services | No network/service dependency |
| Database and Queue | Confirm no schema, queue, or persistence mutation is required | Static-only test evidence |
| Provider Verification | Confirm no model/provider call is made | No provider dependency |
| Communications and Identity | Confirm no external message or call can be initiated | No dispatch capability |
| Frontend and Accessibility | Confirm the benchmark does not alter frontend assets | Test-only file scope |
| Documentation and Release Readiness | Record acceptance criteria and review gates | This benchmark contract |

The twelve module agents are assessed for roster integrity, one-to-one module ownership, safe action declarations, and deterministic task routing.

## Benchmark gates

1. Exactly ten shared workers are present and uniquely identified.
2. Exactly twelve module agents own twelve distinct module IDs.
3. Every roster entry has a name, responsibility, task type, and bounded action list; module agents also have KPIs.
4. No declared action grants deployment, production mutation, migrations, secret/credential access, external dispatch, merge, permission changes, brokerage, or live orders.
5. Known task types resolve to the expected owner.
6. Unknown workers, agents, modules, and task types return `null` (fail closed).
7. Repeated reads produce stable roster and routing results.

## Run

```bash
node --import tsx --test scripts/worker-workforce-benchmark.node-test.mjs
```

## Scoring

Five test groups are the benchmark units. Each passing group earns 20 points. A group earns zero if any assertion in that group fails. Report the actual Node test summary; do not infer a pass from a queued or skipped run.

## Boundaries

This benchmark does not start worker processes, claim that agents are online, create task-queue records, invoke models, access external providers, write to a database, send communications, change infrastructure, or deploy. It validates the current workforce contracts only. Runtime dispatch and worker availability require separate live evidence.

The pull request is review-only. Do not merge automatically. Require exact-head CI/security results and human review before any merge decision.
