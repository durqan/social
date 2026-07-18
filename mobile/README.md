# Social Mobile

React Native Android-клиент Social. Приложение использует REST API, один WebSocket-клиент для realtime и call lifecycle, официальный LiveKit React Native SDK для media, FCM/Notifee для push-уведомлений и native cookie jar для сессии.

## Требования

- Node.js 22.11+ и npm.
- JDK 17.
- Android SDK platform 36 и build tools 36.
- Запущенный backend.
- `android/app/google-services.json` для реальных FCM push.

## Структура

```text
src/app/            корневые providers и запуск приложения
src/navigation/     navigator, route types и deep links
src/screens/        экраны авторизации и основного приложения
src/components/     переиспользуемые UI-компоненты
src/features/       крупная feature-логика чата
src/api/            HTTP-клиент, API-модули, REST-типы и WebSocket-контракт
src/calls/          LiveKit Room/media controls и backend/WS/FCM lifecycle
src/notifications/  FCM, локальные уведомления и переходы
src/context/        состояние сессии, звонков и уведомлений
src/crypto/         E2EE и защищённое хранение ключей
src/config/         runtime/build configuration
src/theme/          единая тема приложения
src/utils/          небольшие общие функции
```

Типы REST-ответов находятся в `src/api/domain.ts`, WebSocket-события — в `src/api/wsEvents.ts`, а mobile push payload — в `src/notifications/types.ts`. Все они являются обычными исходниками приложения; внешний workspace-пакет и специальные Metro aliases не нужны.

## Локальный запуск

Установите точные версии зависимостей из lock-файла:

```bash
cd mobile
npm ci
```

Для Android emulator укажите адрес хоста `10.0.2.2` и запустите Metro:

```bash
SOCIAL_API_BASE_URL=http://10.0.2.2:8080 npm start
```

В другом терминале соберите и установите приложение:

```bash
cd mobile
npm run android
```

Для физического телефона используйте LAN IP машины с backend. Значения `SOCIAL_*` инлайнятся в JS bundle во время сборки, поэтому Metro или Gradle нужно запускать с нужным окружением.

## Конфигурация

- `SOCIAL_API_BASE_URL` — REST API; production URL обычно заканчивается на `/api`.

WebSocket URL строится из API URL автоматически. Public LiveKit URL и короткоживущий join token возвращает backend; LiveKit API key/secret и TURN credentials в mobile configuration отсутствуют.

## Сессия и storage

Backend хранит access/refresh session в HttpOnly cookies. Мобильный HTTP-клиент использует native cookie manager, получает CSRF token через `/auth/csrf`, обновляет сессию через `/auth/refresh` и один раз повторяет исходный запрос. Access token не дублируется в AsyncStorage.

E2EE-ключи хранятся через `react-native-keychain`/Android Keystore. AsyncStorage используется только для несекретного состояния и миграции старых локальных данных.

## Realtime, звонки и push

- `src/api/ws.ts` — единственная реализация основного WebSocket и его reconnect.
- `src/api/wsEvents.ts` — типы и имена WebSocket-событий.
- `src/context/CallContext.tsx` — UI/business state звонка.
- `src/calls/liveKitCall.ts` — `Room`, tracks, `AudioSession` и media controls.
- `src/calls/callLifecycle.ts` — REST lifecycle, call events и FCM recovery.
- `src/notifications/pushNotifications.ts` — регистрация FCM и mobile token.
- `src/notifications/localNotifications.ts` — foreground/incoming-call notifications.

Push payload содержит структурированные `type`, `sender_id`, `conversation_id`, `call_id` и другие необходимые поля. Навигация не зависит от URL из browser-уведомлений. Email verification и password reset открываются через `social://verify-email/:token` и `social://reset-password/:token`.

## Основные API

- `/auth/*` — login, register, refresh, logout, email verification и reset password.
- `/users/*` — профиль, поиск, аватар и друзья.
- `/posts/*` — лента, комментарии и лайки.
- `/conversations` — cursor pagination списка диалогов и pinning.
- `/messages/*` — сообщения, read state, вложения и реакции.
- `/calls/*` — создание/восстановление звонка и выдача LiveKit token; `/ws` — lifecycle без SDP/ICE.
- `/notifications/*` и `/push/mobile-token` — список уведомлений и FCM-токены.

## Проверки и сборка

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
```

Signed AAB и release APK собираются GitHub Actions с Firebase и signing secrets. Полная настройка release: [`GOOGLE_PLAY_RELEASE.md`](GOOGLE_PLAY_RELEASE.md).
