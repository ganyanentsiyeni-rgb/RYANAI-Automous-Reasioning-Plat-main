# RyanAI PhoneLink Android companion

This Android module pairs a phone with the authenticated RyanAI account and provides a native mobile inbox.

## Pairing and trust
1. Open the authenticated RyanAI PhoneLink workspace and generate a QR code.
2. Scan it with this companion. QR decoding happens on-device; camera frames are not uploaded.
3. The browser opens the RyanAI pairing page. Sign in to the same account and explicitly approve the phone and its capability scopes.
4. The browser offers an app handoff using a two-minute, single-use exchange code.
5. The app exchanges that code for a random device bearer token. Only the SHA-256 token digest is stored by RyanAI; the token itself is encrypted locally using an Android Keystore AES-GCM key.
6. Revoking the device in RyanAI disables the token immediately.

## Mobile inbox
- The foreground companion refreshes the event inbox every 30 seconds while the inbox screen is open.
- WorkManager performs best-effort background inbox checks on Android's 15-minute minimum periodic interval.
- Notifications require the Android notification permission. Events are acknowledged only after a notification can be posted or after the user acknowledges them in the app.
- Device tokens are scoped to one paired device and only receive event types permitted by the device's current capabilities.

## Build
Open the `android` directory in Android Studio with JDK 17 and Android SDK 35, then build the `phonelink` app module. The default API host is the RyanAI Vercel domain; override it with the Gradle property `phonelinkRyanaiHost` when building a different approved environment.

## Privacy and limitations
- Camera permission is requested only for QR scanning. QR decoding is local.
- The app does not read SMS, call logs, contacts, clipboard, location or notification contents from other apps.
- Live RyanAI voice is a separate opt-in PhoneLink capability (`voice.live`). The user must start it from the visible companion app after granting Android microphone permission. Android runs it as a microphone foreground service with an ongoing notification and Stop action; it is not a wake-word or always-listening service.
- The service requests a short-lived single-use RyanAI voice ticket using the paired device token. The API rejects devices that have not been granted `voice.live`.
- No remote phone control or automatic message dispatch is implemented.
- File transfer, Android share-sheet intake, offline media sync, push-provider delivery, voice/camera uploads and Android App Links domain verification remain separate increments.
- Background checks are best-effort Android WorkManager jobs, not a guaranteed real-time push channel.
