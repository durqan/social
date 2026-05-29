# Social Mobile

React Native Android client для существующего backend API. Приложение живет отдельно от `frontend` и `backend` и не требует изменений web-клиента.

## Требования

- Node.js 22.11+.
- npm.
- Android Studio с Android SDK, platform 36, build tools 36.
- JDK 17+ в `PATH`.
- Запущенный backend API.

## API base URL

По умолчанию Android emulator ходит в backend по адресу:

```sh
http://10.0.2.2:8080
```

Для физического телефона используйте LAN IP машины с backend:

```sh
SOCIAL_API_BASE_URL=http://192.168.1.10:8080 npm run start
```

Если backend доступен через reverse proxy с `/api`, можно указать:

```sh
SOCIAL_API_BASE_URL=https://example.com/api npm run start
```

## Установка и запуск

```sh
cd mobile
npm install
npm run start
```

В другом терминале:

```sh
cd mobile
npm run android
```

## Debug APK

```sh
cd mobile
npm run build:android
```

APK после сборки:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Release APK/AAB требует собственного signing config и production keystore. Фейковые release-ключи здесь не настраивались.

## Release APK

```sh
cd mobile
SOCIAL_API_BASE_URL=https://example.com/api npm run build:android:release
```

APK после сборки:

```text
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Release variant собирает JS bundle внутрь APK, поэтому установленное приложение запускается без Metro. `SOCIAL_API_BASE_URL` встраивается в JS bundle во время сборки. Для production/release используйте публичный HTTPS backend URL, например `https://example.com/api` при reverse proxy или `https://api.example.com` при прямом backend API. Не используйте `localhost`, `127.0.0.1`, `10.0.2.2` или LAN IP.

Текущая CI-сборка подписывает release APK debug keystore из React Native template; для production публикации нужен отдельный signing config.

## Build APK via GitHub Actions

1. Откройте GitHub -> Actions.
2. Выберите workflow `mobile-android-apk`.
3. Нажмите `Run workflow`.
4. В поле `api_base_url` введите публичный HTTPS backend URL, например `https://example.com/api`.
5. После завершения job откройте run и скачайте artifact `social-mobile-debug-apk`.
6. Для APK без Metro скачайте artifact `social-mobile-release-apk`.

Workflow передает `api_base_url` в `SOCIAL_API_BASE_URL` для всей сборки, проверяет, что URL начинается с `https://`, не указывает на localhost/emulator/LAN/private IP, не содержит двойной путь `/api/api`, и отдельно проверяет, что старая зависимость `@react-native-cookies/cookies` не установлена.

Artifact содержит debug APK:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Release artifact содержит:

```text
mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Реализованные экраны

- Login.
- Register.
- Email verification notice.
- Home.
- Profile.
- Friends.
- Chat list.
- Chat screen.
- Settings / Logout.

## Подключенные API

- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/logout`
- `GET /auth/csrf`
- `POST /auth/refresh`
- `POST /auth/send-verification`
- `GET /users/profile`
- `GET /users/friends/list`
- `GET /users/friends/requests`
- `PATCH /users/friends/:id/accept`
- `DELETE /users/friends/:id`
- `GET /messages/conversations`
- `GET /messages/with/:userId`
- `PATCH /messages/read/:userId`
- `GET /messages/unread/count`
- `POST /messages/upload`
- `POST /messages/send/:toId`
- `GET /ws` for realtime chat events when cookie auth works in React Native.

## Auth и хранение сессии

Backend уже использует httpOnly cookies для access/refresh session и CSRF cookie/header. Mobile client не сохраняет access token в AsyncStorage или localStorage-подобном хранилище. Cookies хранятся в native cookie jar через cookie manager, CSRF token читается из cookie и отправляется в `X-CSRF-Token`.

REST refresh flow:

1. Unsafe requests получают CSRF через `/auth/csrf`.
2. При `401` клиент вызывает `/auth/refresh`.
3. Исходный запрос повторяется один раз.
4. При logout cookies очищаются локально.

## Чат и изображения

- Диалоги загружаются через REST.
- Сообщения загружаются через REST.
- Отправка текста и изображений работает через WebSocket при активном соединении, иначе fallback через REST.
- Image picker поддерживает JPEG, PNG, WebP, максимум 10 MB на файл и максимум 5 изображений.
- Перед отправкой показывается preview выбранных изображений.

## Android permissions

Добавлены:

- `INTERNET`
- `READ_MEDIA_IMAGES`
- `READ_EXTERNAL_STORAGE` с `maxSdkVersion=32`

Camera и microphone permissions не добавлены, потому что звонки в первом этапе не реализуются и runtime permissions раньше времени не запрашиваются.

## TODO

- Полноценная мобильная стратегия auth, если cookie/WebSocket auth окажется нестабильной на production: отдельный mobile login/refresh flow с refresh token rotation и хранением refresh token в Android Keystore/iOS Keychain, не ломая web cookies.
- Realtime hardening: проверить `Origin`, cookies и proxy для `/ws` на production и при необходимости добавить bearer/session auth для WebSocket.
- Лента постов и создание постов.
- Редактирование профиля, аватара и пароля.
- Поиск пользователей и отправка новых friend requests.
- Deep link для `/auth/verify-email/:token`, если email-подтверждение нужно открывать прямо в mobile app.
- Push notifications.
- Dark/light theme provider.
- Звонки: отдельная интеграция `react-native-webrtc`, permissions camera/microphone, native setup и проверка совместимости текущего signaling.
