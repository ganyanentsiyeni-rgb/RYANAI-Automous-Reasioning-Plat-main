# RyanAI Docker and database boundaries

This repository's Compose stack is a local development and integration-test topology. It is not a declaration that hosted databases should be rebuilt as containers.

## Three application data services

| Logical service | Hosted authority | Container policy | Boundary |
| --- | --- | --- | --- |
| Core application database | Supabase PostgreSQL | Do not create a production database Dockerfile or copy production data into Compose. Local pgvector Postgres is disposable/test-only. | Supabase Auth and the core application schema remain authoritative. |
| Audiobook database | Neon PostgreSQL | Managed externally; do not create a local production replacement. | Use only `AUDIOBOOK_DATABASE_URL` and `AUDIOBOOK_DATABASE_URL_UNPOOLED`; keep audiobook migrations separate from core migrations. |
| Cache and queue transport | Railway Redis/Valkey in hosted environments | Use the platform-managed service. The Compose Redis container is local-only and isolated by its own volume and password. | Never store authoritative identity or durable business records only in Redis. |

The optional MCPJungle PostgreSQL service is an infrastructure dependency for the opt-in `mcp-gateway` Compose profile; it is not one of the three RyanAI application data services.

## Image responsibilities

- `Dockerfile`: multi-target API, web, one-shot migration, and Studio worker images.
- `Dockerfile.api`: standalone API image for platforms that need a dedicated API Dockerfile.
- `Dockerfile.mcp_server`: standalone, non-root MCP HTTP service with a healthcheck.
- `docker-entrypoint.sh`: validates proxy inputs, renders the nginx template with a strict envsubst allowlist, validates the rendered nginx config, then execs nginx.
- `docker-compose.yml`: local-only Postgres/Redis, API, web, MCP and optional MCPJungle services. The local migration service is profile-gated.

## Railway isolation requirements

1. Production and staging must not share a persistent database volume, database URL, Redis URL, or credentials.
2. The same volume must never be attached to both Production and Staging. Verify the volume attachment in Railway before enabling either environment.
3. Keep Supabase and Neon connection strings in their respective Railway service environment variables; never bake them into an image, build argument, Compose file, or Git commit.
4. Use separate credentials and databases for staging. Do not copy Production secrets into staging.
5. Run database migrations as a separately reviewed one-shot job. API startup and image build must not migrate a hosted database.
6. Seal secret values in the Railway dashboard where the platform supports it. This repository does not contain secret values and cannot seal variables in Railway on its own.
7. Do not route frontend traffic to the Railway API until deployment health, authentication, CORS, and integration checks pass.

## Current Railway audit warning

The Railway audit performed for this repair found the same Railway volume ID attached to `ryanai-api` in both Production and Staging. This is an isolation blocker, not a change made by this PR. Do not detach, reassign, resize, or delete that volume until an administrator has confirmed the intended data ownership and a verified backup. Resolve the attachment through a separately approved Railway change.
