# RyanAI Twilio Verify — Gates 1 and 2

## Authority boundaries
- Supabase Auth remains the identity, credential, session, and account-lifecycle authority.
- Twilio Verify creates and checks channel-verification challenges only.
- RyanAI routes must construct the verification actor from a verified Supabase user or a server-created pre-auth flow. Never accept a subject/user ID from request JSON.
- A Twilio approved result does not create a Supabase session, update a Supabase factor, or establish aal2.
- Sensitive purposes require an already-established Supabase aal2 session. Supabase TOTP enrollment/challenge/verify remains the route to Supabase MFA assurance.

## Gate 1: purpose contract
verificationPolicy.ts defines signup, login, account recovery, email change, phone change, new device, sensitive account change, and admin access. It enforces authenticated/pre-auth boundaries, actor-to-user ownership, admin role, and existing aal2 for sensitive purposes. The existing Supabase middleware now calls getUser for the live identity and getClaims to cryptographically verify the JWT and attach only its aal1/aal2 claim to request.authUser; claim subject mismatch or unavailable claims fail closed.

Pre-auth routes must generate an opaque server-side flow ID for subjectId; authenticated routes must set subjectId === userId from request.authUser.

## Gate 2: provider adapter
twilioVerify.ts implements Twilio Verify SMS, WhatsApp, voice call, and email through the existing twilio dependency. It uses only pre-existing environment names: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID.

Missing/invalid configuration fails closed. No credential is created, changed, or printed.

Challenge metadata is kept in Redis for 10 minutes. It stores an opaque subject binding, purpose, channel, provider verification SID, state, attempt count, and creation timestamp. It does not store OTPs or destinations. A per-subject/purpose/channel start throttle is 60 seconds; check attempts are serialized with a short Redis lock and capped at five. Challenge checks are bound to the same subject and purpose that started them.

Supported channels in this first adapter: sms, whatsapp, call, email. Silent Network Authentication, Verify Push, Twilio TOTP, passkeys, and Lookup are deliberately not enabled here; they need separate capability/risk evaluation and must not be implied by this adapter.

## Not included in Gates 1–2
No routes are registered and no live verification can be triggered by this PR. Gate 3 must add authenticated/anonymous route policies, ownership/destination resolution from Supabase, route-level limits, and safe status responses. Audit persistence, fraud/Lookup, resend policy, Supabase MFA factor management, and channel-country allowlists remain separate gates. No database schema or production configuration changes are made.