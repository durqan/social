# Social

Мобильная социальная сеть: React Native Android-приложение и Go backend. Backend предоставляет REST API, WebSocket-чат, signaling для WebRTC-звонков и FCM push-уведомления.

## Состав проекта

```text
backend/              Go API, WebSocket, фоновые задачи и миграции
mobile/               React Native Android-приложение
infrastructure/nginx/ production API gateway и TURN SNI routing
docker-compose.local.yml
docker-compose.prod.yml
.env.example
.env.local.example
```

Основные зависимости backend: PostgreSQL, Redis, FCM и local/S3-compatible storage. Локальный S3 предоставляется MinIO. Coturn нужен для WebRTC-звонков вне простой локальной сети. Уведомления сохраняются в PostgreSQL outbox и доставляются встроенным worker backend напрямую в FCM; video-import worker подхватывает сохранённые задания из PostgreSQL ограниченным пулом workers.

## Возможности

- JWT-сессии в HttpOnly cookies, refresh token, CSRF и rate limiting.
- Профили, поиск, друзья, блокировки, посты, комментарии и лайки.
- Личные сообщения, вложения, реакции, ответы, пересылка, закрепление и статусы прочтения.
- WebSocket-синхронизация чатов и состояния звонков.
- Server-side encryption-at-rest и client-side E2EE для поддерживаемых диалогов.
- Аудио- и видеозвонки через WebRTC/Coturn.
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
  up -d postgres redis minio minio-create-bucket
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

`DATABASE_URL` и `REDIS_*` в `.env.example` уже ориентированы на опубликованные local Compose-порты. Перед запуском задайте непустой `MESSAGE_ENCRYPTION_KEY` (`openssl rand -base64 32`). Для реальных push задайте FCM project и Firebase service account credentials непосредственно backend.

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

Coturn включается отдельным profile:

```bash
docker compose --env-file .env -f docker-compose.prod.yml --profile turn up -d
```

Production Nginx служит только API gateway: `/api/` направляется в backend, `/ws` — в WebSocket. На порту 443 SNI для TURN-домена направляется в Coturn.

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
npm run build:android
```

TypeScript-типы REST-контрактов, WebSocket-событий и push payload принадлежат мобильному приложению и находятся в `mobile/src/api` и `mobile/src/notifications`; отдельного workspace-пакета и шага его сборки нет.
