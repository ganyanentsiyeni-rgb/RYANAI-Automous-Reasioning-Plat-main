# Hosted primary database binding — U2EB incident note

## Observed runtime evidence (26 November 2026)

The Render U2EB API service `ryanai-api-u2eb` is reachable and its liveness endpoint `/health` returns HTTP 200. This is not a database-readiness signal.

Render application logs show the agent queue worker failing its Prisma raw query with PostgreSQL error `42P01` (`relation "agent_runs" does not exist`). The PA observer reports the API, PostgreSQL connectivity, Redis and checkpointer as available, but `agentWorker=false` and overall work state `degraded`.

A read-only inspection of the configured Supabase project `omqavyppdoniehseokvx` found `public.agent_runs` and `public._prisma_migrations`; the table includes the queue/lease fields expected by the runtime contract. This proves the objects exist in that Supabase project, but does not prove that the running Render process is connected to it.

A separate legacy Render PostgreSQL instance named `ryanai_database` was also inspected read-only. It has no `public.agent_runs` or Prisma migration ledger. Its Render environment ID differs from the U2EB API service environment ID, so this inspection does not establish that the U2EB API uses that legacy instance.

## Configuration correction

Hosted staging and production API startup now fail closed unless all of the following are supplied:

- `DATABASE_URL` — PostgreSQL URL for the primary RyanAI database.
- `SUPABASE_URL` — HTTPS URL identifying the same Supabase project.
- `SUPABASE_SESSION_POOLER_HOST` — exact Session Pooler hostname copied from that project's Supabase Connect panel.
- `REDIS_URL` — required cache endpoint.

The startup guard rejects a hosted database URL that does not match the project identified by `SUPABASE_URL`. It also rejects missing project or pooler mapping rather than silently accepting an arbitrary PostgreSQL host. Explicit local Compose and opt-in loopback disposable test modes remain exempt.

No connection-string values or secrets are logged or committed. Do not point U2EB at the legacy Render PostgreSQL instance to work around the missing relation.

## Operator remediation and verification

1. In the Render `RyanAI-2` workspace, inspect the existing `ryanai-api-u2eb` environment variables without copying secrets into tickets or chat.
2. Confirm `SUPABASE_URL` identifies project `omqavyppdoniehseokvx`.
3. Confirm `DATABASE_URL` uses that same project's database and that its Session Pooler username is project-qualified as `postgres.<project-ref>`; keep the password secret.
4. Confirm `SUPABASE_SESSION_POOLER_HOST` is the exact EU Central host shown by Supabase Connect, and the API container has the trusted Supabase CA configured for `verify-full`.
5. Do not run migrations or modify a hosted database until the exact target and migration history have been independently reconciled and the production/staging migration approval gate is satisfied.
6. After an approved configuration repair and governed build, verify `/readyz`, the AgentRun queue claim path, worker heartbeat, and MCP health independently. `/health` alone is only liveness.

## Release boundary

This patch changes startup validation and regression tests only. It does not change Render variables, create/rotate credentials, apply migrations, restart services, or deploy. A startup failure after this guard is enabled is intentional evidence of missing/mismatched configuration, not proof that a migration should be run against an arbitrary database.
