# RyanAI PhoneLink

PhoneLink is the first-party, account-authenticated device bridge between Android and RyanAI.

## Current vertical slice
- Authenticated device inventory, short-lived single-use pairing codes, same-account pairing claim, capability scopes and device revocation.
- The server stores only SHA-256 pairing-code digests. Codes expire after five minutes and are consumed atomically.
- The web workspace exposes locally generated QR pairing links, trusted-device controls, per-device capability scopes and a polling Comms event inbox.
- Browser pairing requires the user's existing Supabase-authenticated RyanAI session. The approved phone exchanges a two-minute one-time code for a revocable device token; RyanAI stores only the token digest and Android encrypts the token with an Android Keystore AES-GCM key.

## Security boundaries
- Pairing requires the phone to authenticate to the same RyanAI account as the dashboard that created the pairing code.
- A pairing code is single-use, expires after five minutes, and is never a permanent bearer credential.
- Revocation marks a device unusable in the registry and immediately invalidates its bearer token.
- Capabilities are opt-in scopes; the server filters unknown scope names.
- No background SMS/call/notification/clipboard/location surveillance or remote phone control.
- Outbound SMS, WhatsApp, email and voice dispatch remain governed by RyanAI Comms' existing human-review checkpoint.
- No third-party QR rendering service is used; QR generation and scanning are local.

## Migration
The SQL migration is intentionally included but not applied. Production database migration requires separate approval.

## Remaining native integration
- Android companion package and deep-link registration beyond the pairing scanner.
- Native QR camera scanner and locally generated QR rendering.
- Android Keystore-backed device-bound credential exchange.
- Android share-sheet target, scoped media/document pickers and push-notification provider. Foreground inbox polling runs while the app is open; WorkManager provides best-effort 15-minute background checks, not guaranteed real-time push.
- End-to-end tests on a physical Android device.
