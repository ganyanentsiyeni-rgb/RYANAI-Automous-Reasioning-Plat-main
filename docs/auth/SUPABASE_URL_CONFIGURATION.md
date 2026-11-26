# Supabase Auth URL Configuration — U2EB

## Hosted project

Project ref: `omqavyppdoniehseokvx`

Primary RyanAI web origin:

`https://ryanai-web-u2eb.onrender.com`

## Site URL

Set **Authentication → URL Configuration → Site URL** to:

`https://ryanai-web-u2eb.onrender.com`

Do not use a wildcard for Site URL. Supabase uses Site URL as the default redirect when an explicit `redirectTo` is not supplied, and the RyanAI frontend uses `window.location.origin` for social sign-in callbacks.

## Redirect URLs

The current RyanAI browser authentication code redirects to the current web origin. Therefore the allow-list should contain the web origins actually used by RyanAI:

### Production

`https://ryanai-web-u2eb.onrender.com`

### Local development

`http://localhost:1420/**`
`http://127.0.0.1:1420/**`
`http://localhost:3000/**`
`http://127.0.0.1:3000/**`
`http://localhost:5173/**`
`http://127.0.0.1:5173/**`

If a specific local flow uses port 9090, add it explicitly rather than retaining unrelated URLs indefinitely:

`http://localhost:9090/**`
`http://127.0.0.1:9090/**`

### Vercel

Only add the Vercel URL when that deployment is an active authentication target. For the currently listed beta deployment:

`https://ryanai-automous-reasioning-plat-mai-beta.vercel.app/**`

Prefer an exact production URL rather than a broad wildcard for production.

## Remove / correct

Remove the malformed entry:

`https://ryanai-web-u2eb.onrender.com/)**`

Do not add `https://ryanai-api-u2eb.onrender.com` as an authentication redirect merely because it is the API endpoint. RyanAI's browser OAuth callback uses `window.location.origin`, so the callback destination is the frontend origin.

Do not add a hash suffix such as `/#/` to the production OAuth redirect. RyanAI intentionally redirects OAuth to the origin without a hash so Supabase can restore the session before the application hash router takes over.

## OAuth Server relationship

The OAuth Server authorization path is:

`/oauth/consent`

Therefore its hosted consent UI is:

`https://ryanai-web-u2eb.onrender.com/oauth/consent`

Supabase combines the OAuth Server Site URL with the configured authorization path. The third-party OAuth client's own callback URI is a separate setting and must be registered exactly in **Authentication → OAuth Apps**.

## Verification

After saving the hosted settings:

1. Sign in with Google or GitHub from the U2EB frontend.
2. Confirm the callback returns to `https://ryanai-web-u2eb.onrender.com`.
3. Open the OAuth authorization endpoint and confirm Supabase redirects to `/oauth/consent?authorization_id=...`.
4. Approve and deny a test authorization.
5. Confirm the OAuth client receives the registered callback URI.
6. Confirm no redirect lands on the API origin.

Supabase distinguishes general Auth Redirect URLs from OAuth client redirect URIs. General Auth Redirect URLs may use wildcards; OAuth client callback URIs must be exact matches.
