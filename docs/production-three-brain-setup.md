# Production three-brain provider and deployment setup

This guide separates **runtime provider credentials**, **test-runner credentials**, and **frontend deployment settings**. They belong in different systems.

## 1. Put provider credentials on the API runtime

The three-brain implementation is server-side. `src/agent/providerConfig.ts` resolves credentials against the configured endpoint host:

| Brain | Server-side credential | Endpoint and model |
| --- | --- | --- |
| Primary | `NVIDIA_API_KEY` | NVIDIA API / `nvidia/nemotron-3-ultra-550b-a55b` |
| Secondary — Together | `TOGETHER_API_KEY` (falls back to `QWEN_API_KEY`) | `https://api.together.xyz/v1` / `Qwen/Qwen3-235B-A22B-Instruct-2507-tput` |
| Secondary — OpenRouter | `OPENROUTER_API_KEY` (falls back to `QWEN_API_KEY`) | `https://openrouter.ai/api/v1` / `qwen/qwen3-235b-a22b-2507` |
| Secondary — Alibaba Model Studio | `DASHSCOPE_API_KEY` (falls back to `QWEN_API_KEY`) | Regional `/compatible-mode/v1` endpoint / `qwen3-235b-a22b-instruct-2507` |
| Secondary — SiliconFlow | `SILICONFLOW_API_KEY` (falls back to `QWEN_API_KEY`) | `https://api.siliconflow.com/v1` / `Qwen/Qwen3-235B-A22B-Instruct-2507` |
| Secondary — custom OpenAI-compatible host | `QWEN_API_KEY` | Set `QWEN_API_ENDPOINT` and `QWEN_MODEL` to the host's documented values |
| Logic | `LOGIC_API_KEY` or `OPENAI_API_KEY` | OpenAI-compatible endpoint / `gpt-4o-mini` |

The Qwen credential is selected from the endpoint host. `QWEN_API_KEY` is the compatibility fallback for custom endpoints. The Qwen brain never uses `OPENAI_API_KEY`. The model can be overridden with `SECONDARY_REASONING_MODEL` or `QWEN_MODEL`; use the model identifier published by the selected provider. A provider-specific key should be paired with that provider's endpoint and model ID.

For Alibaba Model Studio, use the regional compatible endpoint and a key created for the same region. Region-mismatched DashScope keys can be rejected with HTTP 401. Do not substitute a Together, OpenRouter, or SiliconFlow credential for a DashScope key.

Logic uses `LOGIC_API_KEY` first and falls back to `OPENAI_API_KEY` only when `LOGIC_API_KEY` is unset or empty. An incorrect non-empty `LOGIC_API_KEY` therefore takes precedence over a valid OpenAI fallback.

The corresponding endpoint/model overrides are `NVIDIA_API_ENDPOINT`/`NVIDIA_MODEL`, `QWEN_API_ENDPOINT`/`QWEN_MODEL`, and `LOGIC_API_ENDPOINT`/`LOGIC_REASONING_MODEL`.

**Set provider credentials on the deployed API service**, not in Vite variables or the public frontend. Never add values to Git, Docker build arguments, client-side `VITE_*` variables, issues, or chat. Restart/redeploy the API after changing runtime environment variables so the process loads them.

Render is the default hosted frontend delivery provider and Railway is the default Docker/persistent-workload provider. Model-provider credentials belong only in the approved server-side runtime secret store.

## 2. Put the admin test token on the test runner, not the API

`TEST_ADMIN_ACCESS_TOKEN` is read by `scripts/test-e2e-flow.ts`. It is a **Supabase admin user's access JWT** used by the test runner to authenticate against the API. The probe route itself does not read this environment variable: it uses the normal authenticated request context and requires `request.authUser.role === 'admin'`.

Configure the token as an encrypted GitHub Actions repository or environment secret for the workflow/job that runs the live E2E probe. Also set the non-secret runner variable `RYANAI_LIVE_PROVIDER_TESTS=true`. Do not put this test token in the frontend build environment or expose it to browser code. Do not commit it.

The test runner needs the following:
- `TEST_ADMIN_ACCESS_TOKEN`: admin user's Supabase access JWT, stored as a CI secret.
- `RYANAI_LIVE_PROVIDER_TESTS=true`: enables the real three-brain probe.
- `API_URL` (or `API_BASE_URL`): the deployed API origin.
- `WEB_URL`: the deployed frontend origin for the frontend availability check.

If user-authenticated E2E checks are also required, configure `TEST_USER_ACCESS_TOKEN` as a separate CI secret. The admin token is not a permanent API credential; use a short-lived, least-privileged test identity and rotate it.

The live test calls `POST /api/agent/ops/brains/probe` and requires all three returned brain statuses to be `HEALTHY`. The route is rate-limited to one probe per five minutes and is restricted to authenticated admins. Run it deliberately; each probe makes billable provider calls.

## 3. Use the approved Render and Railway defaults

- **Render** is the default frontend and web/API delivery provider.
- **Railway** is the default Docker and persistent-workload provider.
- The official repository is `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.

Live Render read-back confirms the existing `ryanai-web` and `ryanai-api` services are connected to the official repository and `main`. The web service is a Static Site; the API uses `Dockerfile.api` and `/health`. Both currently report auto-deploy disabled for commits to `main` at the time of the latest service inspection. The checked-in `render.yaml` must be reconciled with the live dashboard before any Blueprint sync. Do not sync the Blueprint or change these production settings without separate approval.

The existing Render production services are not staging. A separate `ryanai-staging` service must be created, connected to the official repository, configured with auto-deploy disabled, and verified as isolated before the Render staging workflow can run.

The authenticated Railway account is `ganyane.ntsiyeni@gmail.com`. Its currently visible RyanAI project contains a production and a staging environment. Do not assume the staging environment is healthy or isolated until its pending staged changes, data stores, networking, and credentials have been reviewed.

## 4. Staging deployment gate

Staging rollouts remain manual-only and staging-only. Every staging workflow must verify:

1. An open pull request whose head SHA exactly matches the requested commit.
2. All required CI and security checks completed successfully for that exact SHA; queued, skipped, cancelled, missing or provider-blocked checks are not passes.
3. An explicit `STAGE` confirmation.
4. A separately identified staging service/project/environment; never reuse the production service ID.
5. An isolation review confirming that databases, storage, networking, Redis and credentials are not shared with production.

The Render staging workflow must verify that the service name begins with `ryanai-staging`, the official repository is connected, auto-deploy is disabled, and the target is not the production API service.

The Railway project currently has a `staging` environment. Its service/data-store changes must be reviewed and the staging API, Redis endpoint, storage and credentials verified as isolated before any staged changes are applied or a staging deployment is attempted. Do not repoint or redeploy the production service as a substitute.

A staging deployment does not authorize production migration, production deployment, secret mutation, DNS changes, or paid-resource changes. Production promotion and database migration remain separate manual approval gates.

## 5. Release evidence required

Do not mark the three-brain stack production-ready until all of these are evidenced:
1. The API service is connected to the official repository and a known commit.
2. API readiness returns HTTP 200 and reports `online`.
3. All three provider credentials are present in the API runtime without exposing their values.
4. The authenticated live probe reports `primary`, `secondary`, and `logic` as `HEALTHY`.
5. The frontend points to the verified API and passes its availability check.
6. Database-backed task/handoff recovery is verified against the deployed database and worker, not inferred from source code alone.
