# Supabase authentication incident investigation — 2026-11-07

## Scope and change control

This is a read-only incident record for the RyanAI sign-in failure. No Supabase Auth settings, provider credentials, user credentials, database schemas, production secrets, or deployments were changed as part of this investigation. Anonymous sign-in is not a workaround for this incident and remains out of scope.

## Confirmed evidence

Supabase Auth and edge logs for project `narsvpwymvlrhurqbthu` show:

| UTC timestamp | Endpoint / grant | Provider | HTTP status | Evidence |
|---|---|---|---:|---|
| 2026-11-07 17:32:26–27 | `GET /authorize` | `google` | 400 | `validation_failed`: `provider is not enabled` |
| 2026-11-07 19:10:46 | `GET /authorize` | `google` | 400 | `validation_failed`: `provider is not enabled` |
| 2026-11-07 20:41:22 | `GET /authorize` | `google` | 400 | `validation_failed`: `provider is not enabled` |
| 2026-11-07 20:49:55 | `POST /token`, `password` | `email` | 200 | Fresh email/password login succeeded |
| 2026-11-07 20:33:48 | `POST /token`, `refresh_token` | — | 200 | Refresh-token request succeeded |
| 2026-11-07 19:34:26 | `POST /token`, `password` | `email` | 200 | Email/password login succeeded |
| 2026-11-07 14:11:32 | `POST /token`, `password` | `email` | 200 | Email/password login succeeded |

The edge log request URLs explicitly include `provider=google`. Their request IDs correlate with Auth log entries carrying the same request IDs and the error `provider is not enabled`:

- 17:32:26–27 UTC: `01a1b711-994b-7046-aafd-914f74a56061`
- 19:10:46 UTC: `01a1b76b-9f93-7989-9803-f2e08acf2c92`
- 20:41:22 UTC: `01a1b7be-91ef-76a9-a834-a4aff5452a09`

The failed Google authorization requests came from the RyanAI Render web origin and the sign-in route. This establishes Google as the provider rejected by these requests. It does not establish whether GitHub is enabled or disabled.

The 20:49:55 UTC password-grant event establishes that email/password authentication succeeded during this investigation. It does not establish that OAuth works or that every sign-in method succeeds. A separate refresh-token failure was recorded at 06:54:53 UTC (`refresh_token_not_found`, HTTP 400); it is distinct from the later OAuth provider errors.

## Repository observations

At investigation time, the official repository main head was:

- `16fc586ad0b20048a55c0ed2ed0863c2f398e739`

The frontend Supabase client defaults to the expected project URL:

- `https://narsvpwymvlrhurqbthu.supabase.co`

The sign-in page invokes OAuth with provider identifiers `google` and `github`, and invokes email/password through `signInWithPassword()`. Its existing OAuth error handler formats the disabled-provider response using the provider label passed by the corresponding button. Existing page tests cover both provider identifiers and a mocked email/password success path.

These source-level tests do not exercise the live Supabase provider configuration or prove that live OAuth credentials are valid. The frontend's provider-specific error text is selected from the same provider value passed to `signInWithOAuth`; the edge request URL independently confirms that the failing live requests were Google requests.

## Current diagnosis

1. **Confirmed:** Three live Google OAuth authorization requests were rejected because Google was not enabled for this Supabase project at the time of those requests.
2. **Not yet established:** Whether GitHub is enabled or disabled.
3. **Confirmed:** A fresh email/password login succeeded at 20:49:55 UTC on 2026-11-07.
4. **Not established:** The current live provider enablement state or OAuth client configuration. The available connected Supabase project tools expose project metadata and logs, but do not expose the Auth provider settings.

## Next read-only verification

- Inspect the live Supabase Auth provider configuration through an authorized read-only settings interface, including Google and GitHub enabled flags and non-secret client-configuration presence. Do not retrieve or expose client secrets.
- If no read-only interface is available through the connected tools, record that limitation and request a read-only dashboard/API access path; do not infer the current state from historical logs.
- Keep any code change on a separate PR branch, require CI/security checks and human review, and do not merge or deploy automatically.

## Acceptance criteria

- The exact failing OAuth provider(s) are evidenced, not inferred from the generic error.
- OAuth and email/password results are reported separately.
- No production setting, credential, secret, migration, or deployment is changed without separate explicit approval.
