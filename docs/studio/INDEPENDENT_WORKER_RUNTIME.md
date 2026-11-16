# Studio Independent Worker Runtime

## What this increment adds

- A separately launchable Node worker entry point at `src/server/engineering/studioWorker.ts`.
- Database-backed Studio task claims, expired-lease recovery, bounded polling and graceful SIGTERM/SIGINT shutdown.
- A registered deterministic `studio.plan` handler that creates a structured planning artifact without repository writes, external provider calls, shell execution or deployment.
- A direct adapter to the canonical `evaluateGenXSecurityEvent` function.
- A private Supabase Storage adapter for Studio artifacts. Object keys are owner/project/task scoped, uploads are bounded and hashed, and signed download URLs are short-lived.
- An authenticated owner approval endpoint for one queued or policy-blocked task. Approval is recorded in the Studio event ledger and cannot override a Gen-X DENY.

## Gen-X behavior

The current Gen-X policy does not have a dedicated Studio worker allow rule. The worker calls the actual deterministic policy with the task type and owner principal. Its current default for this unknown task tool is `REQUIRE_APPROVAL`; this is intentional. The worker only proceeds after the authenticated project owner records a single-task approval. A Gen-X `DENY` remains final.

This is not a broad policy exception and does not authorize arbitrary shell, network, provider, repository, production or external side-effect operations.

## Worker host configuration

The API Dockerfile now exposes a separate `studio-worker` build target whose entry point is the worker process. It is designed to run as a distinct container/service, not inside the API process. No hosting service is provisioned or deployed by this PR: the existing Render free web-service setup does not establish a durable free background-worker entitlement, and this change must not trigger a paid upgrade. A host operator must separately configure the existing approved database and Supabase storage connection settings. The process stays idle unless `STUDIO_WORKER_ENABLED=true` is explicitly set.

## Artifact storage

The new Supabase migration creates a private `ryanai-studio-artifacts` bucket limited to JSON, plain text and Markdown with a 25 MiB object limit and owner-folder RLS. The migration is committed for review only; it has not been applied. The worker uses the existing server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` variables only when explicitly enabled. Artifact metadata is written to the Studio tables after upload.

## Explicit limits

- The included built-in handler is a deterministic plan generator, not a model-powered coding/research specialist.
- The worker does not expose plugin execution, arbitrary tools, shell access, repo write, deploy, external dispatch or production actions.
- Gen-X currently requires owner approval for this new task type; no policy allowlist change is included.
- No production migration, deployment, secret change, paid upgrade, or PR merge is performed by this change.
