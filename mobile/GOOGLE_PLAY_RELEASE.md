# Google Play Android Release

This document is the production release checklist for the React Native Android app.

## Current Android Targets

- `applicationId`: `com.socialmobile`
- `namespace`: `com.socialmobile`
- `minSdkVersion`: `24`
- `targetSdkVersion`: `35`
- `compileSdkVersion`: `36`
- Release artifact: Android App Bundle, `android/app/build/outputs/bundle/release/app-release.aab`
- Runtime engine: Hermes
- Release shrinking: `minifyEnabled=true`, `shrinkResources=true`, with conservative keep rules for React Native, Firebase, Notifee, WebRTC, image/video/file picker, keychain and cookie manager native modules.

Google Play currently requires new apps and updates to target Android 15 / API 35 or higher.

## Required Release Inputs

Do not commit keystores or passwords. Put the upload keystore outside git or in `mobile/android/app/upload-keystore.jks` locally; `*.jks` is ignored.

Required by the GitHub Actions release workflow:

```sh
export SOCIAL_UPLOAD_STORE_FILE=upload-keystore.jks
export SOCIAL_UPLOAD_STORE_PASSWORD='...'
export SOCIAL_UPLOAD_KEY_ALIAS='upload'
export SOCIAL_UPLOAD_KEY_PASSWORD='...'
```

`SOCIAL_UPLOAD_STORE_FILE` may be absolute, or relative to `mobile/android/app`.

Recommended version and production endpoint inputs:

```sh
export SOCIAL_VERSION_CODE=1
export SOCIAL_VERSION_NAME=1.0.0
export SOCIAL_API_BASE_URL=https://example.com/api
```

Optional call connectivity inputs:

```sh
export SOCIAL_TURN_URLS='turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp'
export SOCIAL_TURN_USERNAME='turn-user'
export SOCIAL_TURN_CREDENTIAL='turn-credential'
```

Do not put a privileged long-lived TURN secret in the mobile bundle. If TURN requires credentials, use short-lived/limited credentials issued by backend, or a non-privileged deployment-specific credential that is safe to distribute to app clients.
For mobile networks, configure both UDP TURN on 3478 and TLS TURN on port 443, for example `turns:turn.example.com:443?transport=tcp`. TODO: place TURN in a region close to the primary users, or use a managed TURN provider with regional POPs.

## Local Checks

Do not run local Android release builds on weak machines. The production AAB is built only in GitHub Actions.

Allowed local checks that do not build Android:

- `npm run typecheck`
- `npm run lint`
- `npm test -- --runInBand`

Release builds fail fast in CI if signing is missing, if `google-services.json` is missing, if `SOCIAL_API_BASE_URL` is missing/not public HTTPS, if configured TURN credentials/fallbacks are incomplete, or if version inputs are invalid.

## GitHub Actions Release Build

Workflow: `.github/workflows/mobile-android-release.yml`

Repository variables:

- `SOCIAL_API_BASE_URL`, for example `https://example.com/api`
- `SOCIAL_VERSION_CODE`, optional; defaults to `github.run_number`
- `SOCIAL_VERSION_NAME`, optional; defaults to `1.0.0`
- `SOCIAL_TURN_URLS`, optional; when set, include UDP TURN and TCP/TLS TURN on port 443
- `SOCIAL_TURN_USERNAME`, optional; required when `SOCIAL_TURN_URLS` is set

Repository secrets:

- `GOOGLE_SERVICES_JSON_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`
- `SOCIAL_TURN_CREDENTIAL`, required when `SOCIAL_TURN_URLS` is set

Encode files:

```sh
base64 -w 0 mobile/android/app/google-services.json
base64 -w 0 mobile/android/app/upload-keystore.jks
```

The workflow runs `npm ci`, dependency validation, typecheck, lint, Jest and `bundleRelease`, then uploads `social-mobile-release-aab`.

## Permissions and Policy Notes

Declared Android permissions:

- `INTERNET`: API, WebSocket, media downloads, FCM.
- `POST_NOTIFICATIONS`: Android 13+ push notifications.
- `CAMERA`: photo capture, video notes, video calls.
- `RECORD_AUDIO`: voice messages, video notes, audio/video calls.
- `MODIFY_AUDIO_SETTINGS`: call audio route management.
- `USE_FULL_SCREEN_INTENT`: incoming call notification UI.
- `WRITE_EXTERNAL_STORAGE` with `maxSdkVersion=28`: saving files to Downloads on legacy Android only.

Broad media read permissions are intentionally not declared. Gallery/file selection uses Android system/image/document picker flows.

Full-screen intent is used only for incoming calls. In Play Console, complete the full-screen intent declaration as a calling app feature.

## Firebase and Push

- `google-services.json` must match `com.socialmobile`.
- Default FCM channel id in manifest: `general`.
- Local Notifee channels: `general`, `messages`, `incoming_calls`.
- Foreground, background and opened/killed notification paths are handled in `src/notifications`.
- CI should provide Firebase config through `GOOGLE_SERVICES_JSON_BASE64`.

## Network Security

- Release: cleartext HTTP is disabled by manifest placeholder and `res/xml/network_security_config.xml`.
- Debug: cleartext HTTP remains enabled through `src/debug/res/xml/network_security_config.xml` for emulator/LAN development.
- Production API URLs must be public HTTPS and must not point to localhost, emulator or private LAN IPs.

## Data Safety Inventory

Data collected/processed by app features:

- Account/profile: user id, name, email, avatar, bio, age, email verification status.
- Authentication/session: httpOnly session cookies, CSRF cookie/header.
- Push token: FCM token registered to backend for notifications.
- Social graph: friends, friend requests, blocks/search results.
- User-generated content: posts, comments, chats/messages, reactions, attachments, voice messages and video notes.
- Media access: camera, microphone and user-selected files/photos/videos/audio for user-initiated upload/calls.
- Calls: call ids, peer user ids, signaling metadata, ICE candidates, audio/video media streams during calls.
- Device/network state: connectivity state for retry/offline UX.

Not currently used:

- Location permission/data.
- Advertising ID.
- Third-party crash analytics.

Public policy URLs for Play Console:

- Privacy Policy: `https://durqan.ru/privacy`
- Account deletion: `https://durqan.ru/account-deletion`

## Manual Play Console Steps

1. Enroll in Play App Signing and keep the upload keystore private.
2. Upload `app-release.aab`.
3. Complete Data Safety using the inventory above.
4. Add privacy policy and account deletion URLs.
5. Complete content rating and target audience forms.
6. Complete app access instructions and provide a test account if login is required for review.
7. Complete full-screen intent declaration for incoming calls.
8. Upload store listing assets: icon from `android/play-assets/play-store-icon.png`, screenshots, feature graphic and descriptions.
9. If HTTPS App Links are required later, add an `https` intent-filter and publish `/.well-known/assetlinks.json` for the domain. Current app uses only the custom `social://verify-email` deep link.
10. Test internal track install from Play before production rollout: login, session refresh, chat list, messages, attachments, push, calls, keyboard behavior, back button, app resume/background and offline/reconnect.
