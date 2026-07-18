# Social Mobile

React Native Android-клиент Social. Приложение использует REST API, один WebSocket-клиент для realtime-событий и signaling звонков, FCM/Notifee для push-уведомлений и native cookie jar для сессии.

## Требования

- Node.js 22.11+ и npm.
- JDK 17.
- Android SDK platform 36 и build tools 36.
- Запущенные backend и notifications service.
- `android/app/google-services.json` для реальных FCM push.

## Структура

```text
src/app/            корневые providers и запуск приложения
src/navigation/     navigator, route types и deep links
src/screens/        экраны авторизации и основного приложения
src/components/     переиспользуемые UI-компоненты
src/features/       крупная feature-логика чата
src/api/            единый HTTP-клиент, API-модули и WebSocket
src/notifications/  FCM, локальные уведомления и переходы
src/context/        состояние сессии, звонков и уведомлений
src/crypto/         E2EE и защищённое хранение ключей
src/config/         runtime/build configuration
src/theme/          единая тема приложения
src/utils/          небольшие общие функции
```

Типы сетевых контрактов импортируются из соседнего `../packages/shared`. Metro и TypeScript уже настроены на этот каталог, поэтому его нельзя отделять от приложения при сборке.

## Локальный запуск

Установите точные версии зависимостей из lock-файла:

```bash
cd mobile
npm ci
```

Для Android emulator укажите адрес хоста `10.0.2.2` и запустите Metro:

```bash
SOCIAL_API_BASE_URL=http://10.0.2.2:8080 \
SOCIAL_NOTIFICATIONS_BASE_URL=http://10.0.2.2:8085 \
npm start
```

В другом терминале соберите и установите приложение:

```bash
cd mobile
npm run android
```

Для физического телефона используйте LAN IP машины с backend. Значения `SOCIAL_*` инлайнятся в JS bundle во время сборки, поэтому Metro или Gradle нужно запускать с нужным окружением.

## Конфигурация

- `SOCIAL_API_BASE_URL` — REST API; production URL обычно заканчивается на `/api`.
- `SOCIAL_NOTIFICATIONS_BASE_URL` — notifications service; обычно `/notifications-api`.
- `SOCIAL_TURN_URLS` — список TURN URL через запятую.
- `SOCIAL_TURN_USERNAME` и `SOCIAL_TURN_CREDENTIAL` — TURN credentials.
- `SOCIAL_WEBRTC_FORCE_RELAY=true` — только debug-проверка принудительного TURN relay.

Если `SOCIAL_NOTIFICATIONS_BASE_URL` не задан, он выводится из API URL. WebSocket URL также строится из API URL автоматически.

## Сессия и storage

Backend хранит access/refresh session в HttpOnly cookies. Мобильный HTTP-клиент использует native cookie manager, получает CSRF token через `/auth/csrf`, обновляет сессию через `/auth/refresh` и один раз повторяет исходный запрос. Access token не дублируется в AsyncStorage.

E2EE-ключи хранятся через `react-native-keychain`/Android Keystore. AsyncStorage используется только для несекретного состояния и миграции старых локальных данных.

## Realtime, звонки и push

- `src/api/ws.ts` — единственная реализация WebSocket и reconnect.
- `src/context/CallContext.tsx` — состояние WebRTC-звонка.
- `src/notifications/pushNotifications.ts` — регистрация FCM и mobile token.
- `src/notifications/localNotifications.ts` — foreground/incoming-call notifications.
- `packages/shared/src/ws/events.ts` — источник типов WebSocket-событий.

Push payload содержит структурированные `type`, `sender_id`, `conversation_id`, `call_id` и другие необходимые поля. Навигация не зависит от URL из browser-уведомлений. Email verification и password reset открываются через `social://verify-email/:token` и `social://reset-password/:token`.

## Основные API

- `/auth/*` — login, register, refresh, logout, email verification и reset password.
- `/users/*` — профиль, поиск, аватар и друзья.
- `/posts/*` — лента, комментарии и лайки.
- `/conversations` — cursor pagination списка диалогов и pinning.
- `/messages/*` — сообщения, read state, вложения и реакции.
- `/calls/*` и `/ws` — восстановление звонка и signaling.
- notifications service `/notifications/*` и `/push/mobile-token`.

## Проверки и сборка

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build:android
```

`npm run build:android` создаёт debug APK. Signed AAB и release APK собираются GitHub Actions с Firebase и signing secrets. Полная настройка release: [`GOOGLE_PLAY_RELEASE.md`](GOOGLE_PLAY_RELEASE.md).
