# U2EB Supabase migration execution runbook

## Scope

This runbook covers the reviewed Prisma migration set for the U2EB Supabase project. It is intentionally separate from application startup and Render deployment.

## Required sequence

1. Confirm the target Supabase project identity and current migration history.
2. Record the pre-change schema inventory and migration history.
3. Compare repository migrations in lexicographic timestamp order with the database migration history.
4. Review each pending migration for destructive or irreversible operations before execution.
5. Apply only the reviewed pending migrations in repository order.
6. Re-read migration history and the required application/checkpointer schema.
7. Verify the API readiness contract after the schema is present.
8. Keep Render deployment separate from database migration execution.

## Rollback / recovery

Prisma migrations are forward changes; this runbook does not pretend that an automatic rollback exists. For a newly provisioned U2EB database with no application tables, the primary recovery path is to stop at the first failed migration, preserve the failure evidence, and correct the migration or dependency before continuing. Any destructive migration or migration touching existing user data requires a separate review and recovery plan.

## Safety boundaries

- Never print or commit database credentials.
- Never use a production database URL for U2EB.
- Never treat `/health` as proof that PostgreSQL/LangGraph/application readiness is complete.
- Never run provider inference as part of migration verification.
- Never couple migration execution to Render API startup.
- Do not enable communications, attachments, scheduler, or alerts as a side effect of schema repair.

## Evidence required after execution

Record the applied migration names, resulting schema inventory, failed/blocked migrations if any, and the API readiness result. A queued, skipped, or unavailable CI check is not a passing result.
