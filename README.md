# Social

Мобильная социальная сеть: React Native Android-приложение и Go backend. Backend предоставляет REST API, WebSocket-чат, управление жизненным циклом звонков и FCM push-уведомления; media-соединение обслуживает self-hosted LiveKit.

## Состав проекта

```text
backend/              Go API, WebSocket, фоновые задачи и миграции
mobile/               React Native Android-приложение
livekit/              local/production конфигурация LiveKit Server
infrastructure/nginx/ production API/LiveKit gateway и TURN/TLS SNI routing
docker-compose.local.yml
docker-compose.prod.yml
.env.example
.env.local.example
```

Основные зависимости backend: PostgreSQL, Redis, LiveKit, FCM и local/S3-compatible storage. Локальный S3 предоставляется MinIO. LiveKit отвечает за WebRTC negotiation, ICE, reconnect, аудио/видео tracks и embedded TURN. Уведомления сохраняются в PostgreSQL outbox и доставляются встроенным worker backend напрямую в FCM; video-import worker подхватывает сохранённые задания из PostgreSQL ограниченным пулом workers.

## Возможности

- JWT-сессии в HttpOnly cookies, refresh token, CSRF и rate limiting.
- Профили, поиск, друзья, блокировки, посты, комментарии и лайки.
- Личные сообщения, вложения, реакции, ответы, пересылка, закрепление и статусы прочтения.
- WebSocket-синхронизация чатов и состояния звонков.
- Server-side encryption-at-rest и client-side E2EE для поддерживаемых диалогов.
- Аудио- и видеозвонки через self-hosted LiveKit с embedded TURN.
- Android push-уведомления через Firebase Cloud Messaging.
- Локальное либо S3-compatible хранение файлов.

## Требования

- Docker с Compose plugin — для полного локального стека.
- Go 1.26.2 — для запуска и проверки Go-сервисов без Docker.
- Node.js 22.11+, npm, JDK 17 и Android SDK 36 — для мобильного приложения.

## Быстрый локальный запуск

Создайте локальный env-файл и запустите инфраструктуру вместе с Go-сервисами:

```bash
cp .env.local.example .env.local
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build
```

Проверка состояния и логи:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml ps
docker compose --env-file .env.local -f docker-compose.local.yml logs -f backend
```

Локальные адреса по умолчанию:

```text
Backend health:       http://localhost:8080/health
LiveKit signaling:    ws://localhost:7880
MinIO API:            http://localhost:9000
MinIO Console:        http://localhost:9001
```

Остановка не удаляет persistent volumes:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml down
```

## Запуск Go backend без контейнера приложения

Сначала поднимите только инфраструктурные сервисы:

```bash
cp .env.local.example .env.local
docker compose --env-file .env.local -f docker-compose.local.yml \
  up -d postgres redis livekit minio minio-create-bucket
```

Заполните `.env.example`, затем запустите API из отдельного терминала:

```bash
cd backend
set -a
. ../.env.example
set +a
go run ./cmd/api
```

Video-import worker при необходимости запускается ещё в одном терминале:

```bash
cd backend
set -a
. ../.env.example
set +a
go run ./cmd/video-import-worker
```

`DATABASE_URL` и `REDIS_*` в `.env.example` уже ориентированы на опубликованные local Compose-порты. Для запуска backend на хосте задайте `LIVEKIT_URL=http://localhost:7880`; публичный адрес для emulator остаётся `LIVEKIT_WS_URL=ws://10.0.2.2:7880`. Перед запуском задайте непустой `MESSAGE_ENCRYPTION_KEY` (`openssl rand -base64 32`). Для реальных push задайте FCM project и Firebase service account credentials непосредственно backend.

## Запуск React Native Android

Android emulator обращается к хосту через `10.0.2.2`. Сначала установите зависимости и запустите Metro:

```bash
cd mobile
npm ci
SOCIAL_API_BASE_URL=http://10.0.2.2:8080 npm start
```

В другом терминале:

```bash
cd mobile
npm run android
```

Для физического устройства замените `10.0.2.2` на LAN-адрес машины. Для реальных FCM push добавьте `mobile/android/app/google-services.json`; production-файл в репозиторий не коммитится. Настройка signed AAB описана в [`mobile/GOOGLE_PLAY_RELEASE.md`](mobile/GOOGLE_PLAY_RELEASE.md).

## Production

Создайте `.env` на основе `.env.example`, задайте production secrets, container-адрес PostgreSQL/Redis, S3 и Firebase credentials. Затем запустите стек:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

LiveKit запускается в основном production-стеке. Backend получает только internal `LIVEKIT_URL` и server credentials, а mobile получает короткоживущий token и `LIVEKIT_WS_URL` из `POST /calls/:callId/token`. API secret никогда не входит в mobile bundle.

Production DNS и сертификаты:

- `durqan.ru` — REST и основной WebSocket;
- `livekit.durqan.ru` — LiveKit signaling по WSS с публичным CA-сертификатом;
- `turn.durqan.ru` — embedded TURN/TLS на 443 с отдельным публичным CA-сертификатом.

Откройте на VPS `7881/tcp`, `3478/udp` и `50000-50100/udp`. UDP media не проходит через nginx. Порт 443 использует SNI: HTTPS/WSS завершается в nginx, а `turn.durqan.ru` передаётся напрямую embedded TURN LiveKit на 5349. После обновления сертификата TURN перезапустите `livekit`; после обновления HTTPS-сертификатов перезапустите `gateway`. Self-signed сертификаты для production не поддерживаются.

Room name выводится backend из уникального call ID. PostgreSQL остаётся источником бизнес-состояния (`ringing`, `accepted`, `rejected`, `timeout`, `ended`, `replaced`); LiveKit room не заменяет call log. Основной WebSocket передаёт `call:incoming`, `call:accepted`, `call:reject`, `call:timeout`, `call:end`, `call:busy`, `call:replaced` и heartbeat, но не media negotiation.

## Проверки

```bash
cd backend
go mod tidy
gofmt -w .
go vet ./...
go test ./...
go build ./...
```

```bash
cd mobile
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
```

TypeScript-типы REST-контрактов, WebSocket-событий и push payload принадлежат мобильному приложению и находятся в `mobile/src/api` и `mobile/src/notifications`; отдельного workspace-пакета и шага его сборки нет.
