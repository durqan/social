# Social Mobile

React Native Android client для существующего backend API. Приложение живет отдельно от `frontend` и `backend`; мобильные изменения не требуют изменений web-клиента.

## Требования

- Node.js 22.11+.
- npm.
- Android Studio с Android SDK, platform 36, build tools 36.
- JDK 17+ в `PATH` для локальной Android-сборки.
- Запущенный backend API.
- Для реальных FCM push notifications: Firebase проект и `mobile/android/app/google-services.json`.

## API base URL

В dev-сборке Android emulator по умолчанию ходит в backend по адресу:

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

В пользовательском UI API URL не показывается.

## Установка и запуск

```sh
cd mobile
npm install
npm run start
```

### Зависимости монорепозитория

Мобильное приложение импортирует общий пакет `@social/shared`. Для локального запуска рядом с каталогом `mobile` должен быть доступен пакет `../packages/shared`; это отражено в `tsconfig.json` и `metro.config.js`. Если вы разворачиваете только этот архив отдельно от монорепозитория, сначала добавьте/скопируйте общий пакет `packages/shared`, иначе TypeScript и Metro не смогут разрешить `@social/shared`.

E2EE-ключи хранятся через `react-native-keychain` / Android Keystore с мягкой миграцией старых значений из `AsyncStorage`.


В другом терминале:

```sh
cd mobile
npm run android
```

## Локальная Android-сборка

Debug APK:

```sh
cd mobile
npm run build:android
```

Production release для Google Play собирается как signed AAB только через GitHub Actions. Полный checklist: [`GOOGLE_PLAY_RELEASE.md`](./GOOGLE_PLAY_RELEASE.md).

Для звонков на реальных телефонах TURN-переменные должны быть переданы именно во время сборки AAB: они инлайнятся Metro/Babel в JS bundle. Если `SOCIAL_TURN_URLS` задан, release build требует `SOCIAL_TURN_USERNAME`, `SOCIAL_TURN_CREDENTIAL`, UDP TURN на 3478 и TCP/TLS TURN на 443 порту, например `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp`. Не встраивайте в мобильный bundle привилегированный долгоживущий TURN secret; используйте краткоживущие/ограниченные credentials или backend-issued ICE config.

Release variant собирает JS bundle внутрь Android artefact, поэтому установленное приложение запускается без Metro. Для release используйте публичный HTTPS backend URL; не используйте `localhost`, `127.0.0.1`, `10.0.2.2` или LAN/private IP.

AAB после CI-сборки:

```text
mobile/android/app/build/outputs/bundle/release/app-release.aab
```

Release-сборка не использует debug signing. Если upload keystore, Firebase config или production API URL не настроены в GitHub Actions, workflow завершится ошибкой.

## Build AAB via GitHub Actions

1. Откройте GitHub repository settings.
2. Перейдите в `Secrets and variables` -> `Actions` -> `Variables`.
3. Добавьте repository variable `SOCIAL_API_BASE_URL`, например `https://example.com/api`.
4. При отдельном notifications route добавьте `SOCIAL_NOTIFICATIONS_BASE_URL`, например `https://example.com/notifications-api`.
5. Добавьте repository variable `SOCIAL_VERSION_CODE` и `SOCIAL_VERSION_NAME` или используйте defaults workflow.
6. Для FCM добавьте GitHub Secret `GOOGLE_SERVICES_JSON_BASE64`.
7. Для подписи добавьте `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`.
8. Откройте GitHub -> Actions.
9. Выберите workflow `mobile-android-release`.
10. Нажмите `Run workflow`. Поле `api_base_url` можно оставить пустым; оно нужно только как временный override.
11. После завершения job скачайте artifact `social-mobile-release-aab`.

Workflow проверяет, что `SOCIAL_API_BASE_URL` начинается с `https://`, не указывает на localhost/emulator/LAN/private IP, не содержит двойной путь `/api/api`, прогоняет `tsc`, `lint`, `jest`, а затем собирает signed release AAB.

## Реализованные экраны

- Login.
- Register.
- Email verification notice.
- Home.
- Profile и редактирование поддержанных backend полей.
- Public user profile.
- Friends и входящие заявки.
- User search.
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
- `PATCH /users/:id`
- `PATCH /users/:id/avatar`
- `GET /users/search?q=...`
- `GET /users/friends/list`
- `GET /users/friends/requests`
- `GET /users/friends/status/:id`
- `POST /users/friends/request/:id`
- `PATCH /users/friends/:id/accept`
- `DELETE /users/friends/:id`
- `GET /messages/conversations`
- `GET /messages/with/:userId`
- `PATCH /messages/read/:userId`
- `GET /messages/unread/count`
- `POST /messages/upload`
- `POST /messages/send/:toId`
- `GET /ws`
- `POST /push/mobile-token` в notifications service
- `DELETE /push/mobile-token` в notifications service

## Auth и хранение сессии

Backend использует httpOnly cookies для access/refresh session и CSRF cookie/header. Mobile client не сохраняет access token в AsyncStorage или localStorage-подобном хранилище. Cookies хранятся в native cookie jar через cookie manager, CSRF token читается из cookie и отправляется в `X-CSRF-Token`.

REST refresh flow:

1. Unsafe requests получают CSRF через `/auth/csrf`.
2. При `401` клиент вызывает `/auth/refresh`.
3. Исходный запрос повторяется один раз.
4. При logout локальная сессия очищается даже если сервер временно недоступен.

## Профиль, друзья и поиск

- Профиль показывает имя, email, статус email verification, аватар или placeholder, bio, age и дату регистрации, если поле пришло от API.
- Редактируются только поля, которые поддерживает backend: `name`, `email`, `age`, `bio`.
- При смене email показывается предупреждение о повторном подтверждении.
- Аватар загружается через существующий avatar endpoint.
- Friends screen показывает друзей и входящие заявки, поддерживает принять, отклонить, открыть профиль, открыть чат и удалить из друзей.
- Search screen использует backend search API с debounce и показывает состояния: добавить, заявка отправлена, уже друг, недоступно.

## Чат и изображения

- Диалоги и сообщения загружаются через REST.
- Chat list показывает собеседника, последний текст или `Изображение`, время и unread indicator.
- Chat screen показывает bubble UI: мои сообщения справа, сообщения собеседника слева, время, изображения внутри bubble и статус прочтения/отправки, если данные есть.
- Отправка текста и изображений работает через WebSocket при активном соединении, иначе используется REST fallback.
- Image picker поддерживает JPEG, PNG, WebP, максимум 10 MB на файл и максимум 5 изображений.
- Перед отправкой показывается preview, загрузка имеет состояние progress/error и возможность удалить изображение.
- При открытии чата вызывается mark as read, если API доступен.

## 1-на-1 звонки

- Используется `react-native-webrtc`.
- Signaling идет через существующий backend WebSocket: `call:offer`, `call:answer`, `call:ice`, `call:end`, `call:reject`; контракт с `call_id` описан в `../CALL_EVENTS.md`.
- Поддержаны исходящий и входящий звонок, принять, отклонить, завершить, mute/unmute microphone, camera on/off, switch camera.
- UI звонка mobile-first: remote video на весь экран, local preview, нижняя панель кнопок и состояния connecting/ringing/active/ended/error.
- При logout/background локальные tracks очищаются.

## Lifecycle, сеть и realtime

- Приложение отслеживает foreground/background/resume через `AppState`.
- При возврате в приложение обновляется unread count, chat list и восстанавливается WebSocket при необходимости.
- WebSocket имеет reconnect с backoff, лимитом попыток и восстановлением после возврата сети.
- Сетевые ошибки показываются пользовательским текстом без raw JSON, endpoint URL или stack trace.
- Технические логи оставлены только в dev mode.

## Push notifications через FCM

Подготовлено и подключено:

- `@react-native-firebase/app` и `@react-native-firebase/messaging`.
- Foreground/background/opened notification handlers.
- Normalization payload для `new_message`, `friend_request`, `friend_request_accepted`, `system`.
- Safe navigation fallback при открытии уведомления.
- Android permission `POST_NOTIFICATIONS`.
- Conditional `google-services` Gradle plugin для debug/dev; production release требует `google-services.json`.
- Регистрация FCM token после login через `POST /push/mobile-token`.
- Отвязка FCM token перед logout через `DELETE /push/mobile-token`.

Для CI не коммитьте production `google-services.json`. Закодируйте файл в base64 и сохраните в GitHub Secret `GOOGLE_SERVICES_JSON_BASE64`:

```sh
base64 -w 0 mobile/android/app/google-services.json
```

Workflow декодирует secret в `mobile/android/app/google-services.json` перед сборкой и не печатает содержимое в лог.

### Firebase setup

1. Создайте Firebase project в Firebase Console.
2. Добавьте Android app с package name `com.socialmobile`.
3. Скачайте `google-services.json`.
4. Для локальной проверки положите файл в `mobile/android/app/google-services.json`.
5. Для GitHub Actions сохраните base64 файла в secret `GOOGLE_SERVICES_JSON_BASE64`.
6. Для server-side отправки FCM добавьте в production env notifications service `FCM_PROJECT_ID` и service account credentials через `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`, `FIREBASE_SERVICE_ACCOUNT_JSON` или `GOOGLE_APPLICATION_CREDENTIALS`.

Ручная проверка push:

1. Соберите AAB или release APK с `google-services.json`.
2. Войдите в приложение и разрешите уведомления.
3. Отправьте этому пользователю сообщение или заявку в друзья с другого аккаунта.
4. Сверните приложение и проверьте системное уведомление.
5. Нажмите уведомление: message открывает чат, friend request открывает экран друзей, generic открывает главную.

## Android permissions

Добавлены:

- `INTERNET`
- `READ_MEDIA_IMAGES`
- `READ_EXTERNAL_STORAGE` с `maxSdkVersion=32`
- `POST_NOTIFICATIONS`
- `CAMERA`
- `RECORD_AUDIO`
- `MODIFY_AUDIO_SETTINGS`

Camera и microphone runtime permissions запрашиваются только при запуске звонка.

## TODO

- Deep link для `/auth/verify-email/:token`, если email-подтверждение должно открываться прямо в mobile app.
- Backend-issued ICE config/short-lived TURN credentials для стабильных звонков без встраивания долгоживущего TURN секрета в mobile bundle.
- Полноценная мобильная стратегия auth, только если cookie/WebSocket auth окажется нестабильной на production.
- Лента постов и dark/light theme provider остаются отдельными этапами.
