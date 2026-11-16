# RUNBOOK-DB-001 — Prisma migration conflict response

**Severity:** P1 when production writes or service availability are affected  
**Systems:** RyanAI PostgreSQL, Prisma migration engine, release workflow  
**Scope:** Diagnosis and controlled recovery only. This runbook does not authorize a production migration, DDL, data repair, connection termination, or incident closure.

## 1. Detect and preserve evidence

1. Record the GitHub Actions run URL, triggering actor, commit SHA, exact migration name, and full Prisma error code/message.
2. Preserve the complete workflow log and deployment event log. Redact connection strings, tokens, user data, and SQL literals containing sensitive values.
3. Check PagerDuty maintenance-window state. A deployment failure does not prove that the window opened or closed successfully.
4. Treat Slack/Grafana/PagerDuty notifications as signals, not proof of database state.

Common Prisma codes:
- **P3009:** a failed migration is recorded in migration history and blocks further deploys.
- **P3018:** a migration failed while applying; inspect the database error and exact SQL statement.
- **P2024:** Prisma timed out obtaining a connection from its pool. This is not, by itself, evidence of a PostgreSQL lock conflict.

## 2. Immediate containment

- Stop further release attempts. Do not rerun `migrate deploy` repeatedly.
- Do not merge a repair that changes migration history or production DDL without database-owner review.
- Do not terminate database backends, drop objects, edit `_prisma_migrations`, or run `migrate resolve` as a first response.
- Keep application services running unless the incident commander/database owner explicitly approves a controlled maintenance action.
- Confirm whether a migration process is still active before taking any action.

## 3. Diagnosis by failure type

### P3009 — failed migration history

1. Identify the exact migration name and inspect its recorded status using a read-only administrative session.
2. Review the migration SQL and logs to determine whether it applied partially, fully, or not at all.
3. Compare the actual schema with the intended post-migration schema using a disposable clone or staging database.
4. Only the database owner may approve `prisma migrate resolve --rolled-back` or `--applied`. Choose neither until the real database state and any partial data changes have been reconciled.
5. Record the approval, operator, migration name, evidence, and recovery result.

### P3018 — SQL/constraint/schema failure

1. Capture the exact failing SQL statement and PostgreSQL error.
2. Inspect the affected table, column, index, constraint, and migration history using read-only queries.
3. Reproduce the migration on a disposable PostgreSQL instance using the repository's ephemeral integration harness.
4. Prepare a reviewed forward-fix or expand/contract migration. Do not edit an already-applied migration file.
5. Validate the fix from both a clean database and an upgrade path representative of the affected schema.

### P2024 — connection-pool timeout

1. Inspect pool configuration, connection counts, application saturation, and long-running transactions.
2. Use read-only `pg_stat_activity` and lock inspection to establish whether a real lock wait exists.
3. Distinguish pool exhaustion from lock contention, network failure, and unavailable database endpoints.
4. Do not issue `pg_terminate_backend` based solely on P2024. Any cancellation/termination requires explicit database-owner approval and a reviewed target PID.

## 4. Recovery and verification

1. Reproduce the failure and candidate fix on disposable PostgreSQL first.
2. Run schema validation, migration upgrade tests, queue/lease concurrency tests, and the exact-head CI/security matrix.
3. Obtain independent database-owner review and human PR approval.
4. Production migration execution requires separate explicit authorization and must satisfy the repository's production migration allowlist. The presence of a manual workflow or PagerDuty window is not authorization.
5. After an authorized recovery, verify migration history, application database connectivity, service health, and relevant queue/worker behavior.
6. Confirm PagerDuty incident state and maintenance-window closure from provider evidence; do not infer either from a successful script exit alone.

## 5. Post-incident review

Record timeline, root cause, blast radius, exact migration and commit, data-integrity assessment, recovery approvals, validation evidence, and follow-up owners. Update migration tests and contributor guidance where the failure exposed a process gap.

## 6. Guardrail

The Prisma breaking-change workflow is a heuristic static guard. A clean result does not certify zero downtime, data safety, index-build performance, or production compatibility. Review generated SQL and test both clean-install and upgrade paths.
