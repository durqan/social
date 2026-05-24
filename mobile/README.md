# Social Mobile

React Native client for Android and iOS, built with Expo and TypeScript.

## Commands

```bash
npm run start
npm run android
npm run ios
```

The mobile app is kept compatible with Expo Go. Native-only modules such as WebRTC are not included.

## API URL

Set the backend URL with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:8080 npm run start
```

Use your machine LAN IP when testing on a physical phone.

## Native Projects

`android/` and `ios/` are intentionally not committed yet. Generate them later when native Android or Swift/iOS code is needed:

```bash
npx expo prebuild
```
