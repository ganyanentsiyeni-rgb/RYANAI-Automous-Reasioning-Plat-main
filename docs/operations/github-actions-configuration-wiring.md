# GitHub Actions configuration wiring

This contract maps the repository's supported model-provider runtime settings to the current Actions secret names. Values are never printed by the application or included in this document.

## Provider aliases now supported

| GitHub secret/config name | Canonical runtime name | Runtime consumer |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | API provider registry |
| `ANTHROPIC_BASE_URL` | `ANTHROPIC_API_ENDPOINT` fallback | API provider registry |
| `ANTHROPIC_DEFAULT_MODEL` | `ANTHROPIC_MODEL_ALLOWLIST` fallback | API provider registry; explicit model only |
| `OPENROUTER_BASE_URL` | `OPENROUTER_API_ENDPOINT` fallback | API provider registry |
| `OPENROUTER_DEFAULT_MODE` | No direct mapping until its value semantics are confirmed | Unresolved; do not assume it is a model ID or mode selector |
| `XAI_API_KEY` | `GROK_API_KEY` fallback | Logic brain and API provider registry |
| `XAI_BASE_URL` | `GROK_API_ENDPOINT` fallback | Logic brain and API provider registry |
| `XAI_DEFAULT_MODEL` | `GROK_MODEL` fallback | Logic brain and API provider registry |
| `RYANAI_DEV_MODEL_KEY` | Environment-scoped generic model credential | Only when `RYANAI_MODEL_PROVIDER` explicitly equals the provider ID and `NODE_ENV` is not `production` |
| `RYANAI_PROD_MODEL_KEY` | Environment-scoped generic model credential | Only when `RYANAI_MODEL_PROVIDER` explicitly equals the provider ID and `NODE_ENV=production` |

Canonical names take precedence over compatibility aliases. The generic RyanAI model keys are never broadcast to all providers: configure a matching `RYANAI_MODEL_PROVIDER` value (for example `openai`, `anthropic`, `openrouter`, `xai`, `nvidia`, or `qwen`) before the generic key can be selected. Do not configure the generic provider key and a provider-specific key with conflicting intent.

## Security boundaries

- Provider credentials stay server-side. Never rename them to `VITE_*`, put them in frontend build arguments, or serialize them in API/MCP responses.
- `VITE_SUPABASE_PUBLISHABLE_KEY` and the Supabase URL are public client configuration; the Supabase secret/service-role key is server-only.
- `VITE_GOOGLE_API_KEY` has no confirmed source consumer in the current codebase. Do not expose it to browser bundles until a documented browser-side Google API integration and strict API-key referrer/API restrictions exist. Prefer server-side `GOOGLE_API_KEY` if a server integration is added.
- `TINYFISH_API_KEY` and the generic `ENDPOINT` entry have no confirmed consumer/contract in the current source snapshot. Do not alias either to an unrelated provider or service. Identify the owning integration and endpoint semantics before wiring.
- `AWS_ENDPOINT_URL_S3` is not consumed by the optional ECS deploy workflow. It belongs to an S3-compatible application/storage client, not the ECS deployment command. It remains pending until that client/configuration is identified.
- AWS access keys are consumed by the optional AWS ECS workflow only when that deployment is explicitly enabled and its remaining non-secret configuration is supplied. Their presence does not enable AWS deployment.
- Model provider verification is a manual-only workflow. Passing secret names into its environment does not prove the remote credentials are valid or that the provider endpoint is reachable.

## GitHub Actions placement

Keep passwords, API keys, tokens, connection strings and private signing material in Actions Secrets. Move only confirmed non-sensitive configuration (for example provider base URLs, model IDs, ports, timeouts, feature flags and public origins) to Actions Variables. Do not move database connection URLs or any value containing credentials to Variables.

Repository Secrets are available to workflows in this repository according to GitHub's event and environment rules; they are not automatically injected into Render, Railway, Vercel, or other hosted runtimes. Configure those providers' runtime secret stores separately through their approved workflows and access controls. No credential values are read, modified, or copied by this contract.
