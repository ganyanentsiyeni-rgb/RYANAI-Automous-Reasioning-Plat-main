# Vercel hosted frontend configuration

## Required Vercel project variables

Configure these values in the canonical RyanAI Vercel project for both Preview and Production deployments:

| Variable | Value / source | Exposure |
| --- | --- | --- |
| `VITE_APP_ENV` | `production` for the production target; the Vercel build command sets this for the web service | Public build metadata |
| `VITE_API_BASE_URL` | `https://ryanai-api-u2eb.onrender.com` | Public API origin |
| `VITE_SUPABASE_URL` | `https://omqavyppdoniehseokvx.supabase.co` | Public project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Existing active `sb_publishable_` key for project `omqavyppdoniehseokvx` | Browser-safe publishable key |

Use the active publishable key from Supabase; do not create a new key solely to fix frontend configuration. Do not put an `sb_secret_` key, service-role key, database URL, or provider credential in any `VITE_` variable.

## Build-time behavior

Vite embeds these values during the build. Updating Vercel environment variables does not repair an already-created deployment; a new build is required.

The Vercel web build now sets `VITE_APP_ENV=production`. The Vite configuration fails the hosted build when the API URL, Supabase URL, or browser-safe Supabase key is missing, when a secret Supabase key is supplied, or when either URL is not HTTPS. This prevents publishing a sign-in page that silently disables auth or sends API calls to the frontend origin.

## Separate runtime verification

The frontend build guard proves only that the required public configuration was supplied to the build. It does not prove that Render is awake, the API health endpoint is reachable, Supabase Auth providers are enabled, or a user can sign in.

After a governed build, verify independently:
1. the deployed frontend bundle is using the Render API origin;
2. the Render API health endpoint responds successfully within the application's configured timeout;
3. the Supabase project remains active and the expected Auth providers/settings are enabled;
4. sign-in and sign-out work with a test account.

No provider variables are changed by this repository patch. No deployment, database migration, key creation, key rotation, or secret mutation is authorized by it.
