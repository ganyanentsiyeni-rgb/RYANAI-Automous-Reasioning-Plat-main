# RyanAI PostgreSQL 19 migration

## Status

RyanAI is prepared for PostgreSQL 19 compatibility testing, but the live databases remain on their current major versions.

- Neon RyanAI source: PostgreSQL 18.7.
- Supabase RyanAI source: PostgreSQL 17.x.
- PostgreSQL 19 was released on 2026-11-19.
- PostgreSQL major upgrades require a migration to a new major-version target; they are not treated as an ordinary schema migration.

## Engineering completed

The CI pipeline now contains a dedicated PostgreSQL 19 compatibility gate using the `pgvector/pgvector:pg19` image. The gate:

1. boots a disposable PostgreSQL 19 instance;
2. creates the minimal Supabase Auth compatibility fixture used by RyanAI migrations;
3. enables `vector`;
4. validates both Prisma schemas against PostgreSQL 19;
5. applies the RyanAI Prisma migrations to PostgreSQL 19;
6. verifies the server major version, required vector extension, and representative migrated tables.

This is intentionally separate from the existing PostgreSQL integration job so a PostgreSQL 16/17/18 regression cannot be hidden by a passing PostgreSQL 19 check.

## Production migration sequence

Do not point production at PostgreSQL 19 until all of the following are green:

1. PostgreSQL 19 compatibility CI.
2. Full application/integration CI.
3. Extension compatibility review for the exact target service.
4. Full data migration rehearsal.
5. Row-count, constraint, index, sequence, and checksum validation.
6. RyanAI workload/performance comparison.
7. Backup/restore verification.
8. Cutover rehearsal.
9. Explicit production cutover approval.

For Neon, the documented migration model is a new PostgreSQL 19 project followed by data migration. Neon supports import, `pg_dump`/`pg_restore`, and logical replication depending on database size and downtime requirements.

## PostgreSQL 19 features relevant to RyanAI

After the target is established and workloads are measured, evaluate:

- `REPACK (CONCURRENTLY)` for high-churn tables;
- `pg_plan_advice` only for demonstrated plan regressions;
- parallel autovacuum and new maintenance statistics;
- logical-replication sequence synchronization;
- `WAIT FOR LSN` if RyanAI adopts read replicas;
- `INSERT ... ON CONFLICT DO SELECT` for get-or-create paths.

These features are not enabled blindly. Each requires workload evidence and compatibility validation.

## Current external blocker

The connected Neon organization is Vercel-managed and the available Neon management API rejected creation of a new PostgreSQL 19 project from this environment. The existing RyanAI Neon PostgreSQL 18.7 database therefore remains untouched.

Once a PostgreSQL 19 target is provisioned in the same approved Neon/Vercel environment, the migration can proceed using the validated target rather than changing the production source in place.

## Safety boundary

This engineering does not:

- change the production database major version;
- delete production data;
- rotate or create credentials;
- expose database credentials;
- bypass GitHub review requirements;
- deploy production services automatically.
