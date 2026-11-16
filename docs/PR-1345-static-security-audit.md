# PR #1345 — Static security review and remediation record

**Review target:** PR #1345 recorded head `3ac4861f107bac40476354f3c75c6c6852d831c2`  
**Review method:** source inspection of the PR head and the target branch, plus implementation of focused remediation in this follow-up branch.  
**This is not a CodeQL, TruffleHog, Bandit, or provider validation report.** Scanner findings must be taken from completed exact-head CI runs.

## Findings from source inspection

### S1 — PagerDuty import had a process-exit side effect

The PagerDuty module read credentials and exited during import when environment variables were missing. That could terminate test runners, tools, or unrelated code importing the module.

**Remediation:** credential validation is now lazy and occurs only when an API operation is requested. Module import is side-effect free. A subprocess smoke test verifies import without PagerDuty environment variables.

### S2 — Production migration path must preserve the repository allowlist

Calling `npx prisma migrate deploy` directly from the production orchestrator would bypass the repository's scoped production migration runner. The existing production runner checks the migration history, allowlist/exclusions, Supabase Session Pooler routing, and verified TLS settings.

**Remediation:** production now calls `npm run db:migrate` with `NODE_ENV=production`, which routes through `src/db/migrate.ts`. Staging uses its separate staging database and the normal staging migration command. The production workflow requires a separate explicit migration approval input and protected production Environment approval. The excluded coding-task migration remains excluded; this PR does not alter the allowlist.

Production execution will fail closed if the required migration name, pooler settings, or verified root CA path are not configured.

### S3 — Deployment logs could disclose secret-bearing values

The orchestrator previously logged full command arguments and exception text without redaction.

**Remediation:** command logging records the executable and argument count, not arbitrary arguments. Structured log fields redact configured PagerDuty token, routing key, database URL, and Slack webhook values. Tests cover redaction.

### S4 — Health endpoint could return non-object JSON

A JSON array or scalar could cause an uncaught attribute error while checking the database field.

**Remediation:** health validation now rejects non-object JSON as an unhealthy response and retries within the configured bounded probe loop. Tests cover this case.

### S5 — Production workflow dispatch needed stronger scope controls

A manually dispatched workflow is not sufficient by itself to establish that it came from the protected release branch or that production database migration approval was separately granted.

**Remediation:** both staging and production jobs are restricted to workflow dispatches from `main`; production additionally requires the exact `APPROVE_PRODUCTION_MIGRATIONS` confirmation and the protected production Environment gate. Staging uses its own Environment, database secret, health URL, rollout command, and telemetry identity.

## Static control review

| Control | Source-level result | Remaining evidence |
|---|---|---|
| PagerDuty credentials | Environment-only; lazy validation | TruffleHog/secret scanner exact-head result |
| Subprocess shell injection | Argument arrays; no `shell=True` | CodeQL exact-head result and review of protected rollout command |
| HTTP timeouts | 10s PagerDuty API; 5s health probe; bounded retries | Bandit/CodeQL result |
| Exception preservation | Original deployment exception preserved if cleanup also fails | Offline tests |
| Production migration scope | Scoped `npm run db:migrate`; existing allowlist retained | CI tests and human database-owner review |
| Workflow permissions | `contents: read`; no PR-comment write token | Actions workflow validation |
| Branch/approval boundary | Manual dispatch from main; separate production migration confirmation and Environment gate | Verify GitHub Environment settings in repository UI |
| Secret redaction | Structured logs redact configured credential values | Offline tests and review |
| Grafana delivery | Alloy/provisioning examples only | Validate Alloy syntax, datasource UID, labels, paths, and live ingestion before claiming integration |

## Prisma compatibility guard

The new `.github/workflows/prisma-breaking-changes-check.yml` compares the target branch schema to the PR schema using Prisma's schema diff, and scans changed migration SQL for configured destructive DDL patterns.

The workflow uses read-only repository permissions and emits GitHub Actions annotations plus a step summary. It intentionally does not grant `pull-requests: write` merely to post a comment. It fails closed if it cannot fetch the base schema or execute the Prisma diff.

This is a heuristic guard, not a complete proof of backward compatibility. It can require human review for safe-but-destructive-looking changes and cannot fully infer data volume, lock duration, application compatibility, or data-loss risk. Review the actual SQL and test both clean-install and upgrade paths.

## Items not performed

- No GitHub secret or environment setting was read, created, changed, or validated.
- No PagerDuty live API request or test incident was sent.
- No Slack webhook was called.
- No Grafana Cloud configuration was applied or tested.
- No production or staging deployment was dispatched.
- No production database migration or DDL was executed.
- No paid plan or infrastructure setting was changed.
- No PR was merged or auto-merged.

## Sign-off status

**Static source review:** remediation implemented in the follow-up PR; independent human review still required.  
**Exact-head CI/security:** pending until GitHub reports completed results for the follow-up PR head.  
**Release readiness:** not certified. Do not infer zero findings from queued, skipped, absent, or provider-blocked checks.
