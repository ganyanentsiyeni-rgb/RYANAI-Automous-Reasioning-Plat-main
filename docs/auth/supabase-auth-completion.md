# RyanAI Supabase Auth completion

## Implemented client flows

- Email/password sign-up and sign-in remain in `src/pages/AuthPage.tsx`.
- Google and GitHub OAuth sign-in remain separate from identity linking.
- `src/lib/supabaseAuth.ts` provides anonymous sign-in, optional CAPTCHA token forwarding, anonymous email linking, verified-email password setup, Google/GitHub identity linking, session/user retrieval, and sign-out.
- Identity linking verifies the current user with Supabase Auth before linking. It does not silently merge an anonymous user into an existing account.
- Anonymous users are intentionally not promoted to RyanAI's privileged API routes. The API currently rejects anonymous sessions; do not change that boundary without an explicit product and RLS policy design.

## Required Supabase Dashboard configuration

For the active project, configure these in **Authentication**:

1. **URL Configuration**: set the Site URL to the deployed RyanAI web origin and add exact allowed redirect URLs for each deployed origin and local development origin. The frontend OAuth `redirectTo` is the current app origin.
2. **Sign In / Providers**: enable Google and GitHub and supply each provider's own OAuth Client ID and Client Secret.
3. In each Google/GitHub OAuth application, set its authorized redirect URI to the Supabase project's callback URL:
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
   Use the callback displayed by the active Supabase project; do not copy a callback from an older project.
4. **Manual identity linking**: enable it only after reviewing identity-linking behavior and account recovery requirements.
5. **Bot and Abuse Protection**: configure Cloudflare Turnstile or hCaptcha before enabling anonymous sign-ins for public traffic.

Dashboard provider credentials and toggles are not stored in this repository. A code commit cannot enable hosted providers or repair a provider-console redirect URI by itself.

## Anonymous sign-in rollout gate

The client helper accepts an optional CAPTCHA token and forwards it as `options.captchaToken`, but anonymous sign-in must remain disabled in the hosted project until all exposed-table RLS policies explicitly distinguish `auth.jwt()->>'is_anonymous'` from permanent users. Anonymous sessions use the Postgres `authenticated` role. Do not grant them owner, admin, communications, memory-write, or other privileged capabilities.

Review each table's existing policies against the actual ownership model before enabling anonymous sign-ins. For write policies, enforce ownership in both `USING` and `WITH CHECK`; do not use user-editable `user_metadata` as an authorization source.

## Identity conversion and conflicts

- Email conversion starts with `linkAnonymousEmail(email)`; the user must complete Supabase's email verification flow.
- Call `setLinkedAccountPassword(password)` only after the user is no longer anonymous and Supabase reports `email_confirmed_at`.
- OAuth conversion uses `linkAnonymousOAuthIdentity('google' | 'github')` and requires Supabase manual linking to be enabled.
- If the email belongs to an existing account, ask the user to sign in to that account and handle data transfer explicitly. Never silently reassign rows or merge carts, memory, files, or workspace data.

## Cleanup

Supabase currently does not automatically clean up anonymous users. Any scheduled cleanup must be designed and reviewed separately; do not run destructive SQL as part of this application change.
