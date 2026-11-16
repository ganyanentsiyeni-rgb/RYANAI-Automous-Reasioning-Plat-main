# Production database migration procedure

RyanAI never applies Prisma schema changes during API startup. The API performs
read-only schema readiness checks. Committed migrations run in a dedicated,
one-shot Docker image through a protected GitHub workflow.

## Two independent approvals

1. Review the migration files included in the current `main` commit.
2. Confirm that the exact commit has completed the required CI/security checks
   and isolated provider verification.
3. Dispatch **Production database migrations** from `main` and select
   `APPLY`.
4. Approve the protected `production-migrations` GitHub environment when its
   reviewer gate is presented.
5. After migrations succeed, a production API deployment requires a separate
   dispatch of **Deploy API to Render** from the same `main` commit, selecting
   `DEPLOY`. The existing Render enable/approval switches and the protected
   `production` environment remain required.

Selecting `NO`, dispatching from a different branch, using a stale main
commit, missing protected connection configuration, or failing any preflight
check stops the migration workflow. A successful migration does not itself
trigger a deployment.

## Required GitHub environment configuration

A repository administrator must configure these settings directly in GitHub.
This PR does not create or modify secrets or environment settings:

- Create the `production-migrations` environment, require at least one
  independent reviewer, and enable **Prevent self-review**. The workflow
  verifies these controls through GitHub's Environment API before it reads the
  database secret or invokes the migration container.
- Add `PRODUCTION_DATABASE_URL` as an environment secret. It must contain the
  current Supabase PostgreSQL connection URL. Do not put it in repository
  files, logs, pull requests, or chat.
- Add `SUPABASE_SESSION_POOLER_HOST` as an environment variable using the
  exact Session Pooler hostname copied from the Supabase project's Connect
  panel. Do not infer or derive the pooler hostname.

The workflow uses the configured Supabase project URL and the bundled public
Supabase Root 2021 CA. The database URL, password, and pooler hostname are
never printed by the workflow.

## Coding-task queue migration: held for independent review

The migration `20261104120000_isolated_coding_task_queue` adds the
`agent_runs.queue_type` discriminator, classifies existing workbench rows as
coding work, and creates the dedicated `coding_tasks` queue and indexes.
The API reasoning worker filters on `queue_type = 'reasoning'`; without this
schema change, its queue-claim SQL fails with PostgreSQL `42703`.

**This migration is explicitly excluded from the production migration
allowlist pending independent human review. Do not dispatch it.** The review
must cover:

- The exact population matched by each `OR` predicate in the migration's
  `UPDATE public.agent_runs` statement, including counts and representative
  redacted samples from the target production database.
- Whether pending approval, non-null plan snapshots, or non-null proposed-diff
  hashes can identify non-workbench reasoning jobs.
- The complete `coding_tasks` table contract, including approval-evidence
  referential integrity, duplicate-task/idempotency behaviour, status/attempt
  constraints, and user/job deletion cascades.
- Worker authorization immediately before execution, cancellation and retry
  races, and compatibility between the Prisma schema and actual SQL DDL.
- A tested recovery/rollback plan and the exact production migration-ledger
  state.

The current migration tests use synthetic fixtures; they do not establish the
production row distribution or prove that the classification predicates are
safe against live data. Do not treat the migration's presence in the repository,
a successful code check, or the earlier allowlist change as migration approval.

Only a separate, reviewed change may add this migration back to the production
allowlist after the impact review is complete. That still does not authorize
execution: a separate manual dispatch from current `main`, the exact migration
name, `APPLY`, successful exact-commit CI/security/provider checks, and
independent protected-environment approval remain mandatory. API startup,
pull-request CI, and documentation/test changes never apply DDL.

## Migration execution

The workflow:

- Runs only through manual dispatch on `main`.
- Requires the explicit `APPLY` input.
- Verifies the exact main SHA, required CI/security checks, and provider
  verification before the protected migration job starts.
- Builds the root Dockerfile's `migrate` target.
- Requires the configured Session Pooler host and bundled CA, normalizes the
  database URL, and enforces `sslmode=verify-full` with Prisma's
  `sslaccept=strict`.
- Runs only committed Prisma migrations; it does not use `prisma db push`.

Render's free web services do not support `preDeployCommand`. The migration
workflow therefore runs separately from the Render API container and from API
startup.

## Deployment dependency

The **Deploy API to Render** workflow is also manual. It requires the explicit
`DEPLOY` input and a successful **Production database migrations** workflow
run for the same exact `main` SHA. It independently verifies current main,
CI/security, provider checks, Redis availability, Render configuration, and
the live API health endpoint. The `production` environment must also require an independent reviewer and
have **Prevent self-review** enabled. The workflow checks these settings
before accessing the Render API credential or invoking a deployment.

A migration success for an older commit cannot authorize deployment of a
newer one. Run the migration workflow again for the current main commit.

## Safety boundaries

- No migration or schema DDL is run by API startup.
- No production database migration is run by this PR or by pull-request CI.
- No database credentials, Supabase secrets, Render settings, or paid plans
  are changed by this PR.
- The migration workflow fails closed when required protected environment
  configuration or approvals are unavailable.
