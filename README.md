# Social Network

Full-stack социальная сеть с веб-клиентом, React Native Android-приложением, REST API, WebSocket-чатом, push-уведомлениями, 1-на-1 звонками и server-side encryption личных сообщений.

## Возможности

### Пользователи и социальные функции

* Авторизация через JWT и HttpOnly cookies.
* CSRF-защита и rate limiting.
* Профили пользователей с аватаром и биографией.
* Поиск пользователей.
* Друзья, заявки в друзья и блокировки.
* Подтверждение электронной почты.
* Ограничение некоторых действий для неподтвержденных аккаунтов.

### Посты

* Создание и редактирование постов.
* Лайки и комментарии.
* Лента публикаций.
* Удаление собственных публикаций.

### Чат

* Приватные сообщения.
* Ответы на сообщения (Reply).
* Пересылка сообщений (Forward).
* Закрепленные сообщения.
* Индикаторы печати.
* Статусы прочтения.
* Массовое удаление сообщений.
* Загрузка изображений, файлов, голосовых и видео-сообщений.
* WebSocket-синхронизация в реальном времени.

### Шифрование сообщений на сервере

* Messages are encrypted at rest on the server before being stored in the database.
* Legacy/plaintext chat sends still use backend AES-256-GCM encryption-at-rest.
* Client E2EE is active when both chat participants have an E2EE backup/public key.
* For client E2EE messages and attachments, the backend stores opaque ciphertext and encrypted blobs.
* Старые plaintext-сообщения с `encryption_version = 0` остаются читаемыми.

### Уведомления

* RabbitMQ-based notification pipeline.
* SSE уведомления.
* Web Push уведомления.
* Android FCM уведомления.
* Уведомления о сообщениях, лайках, комментариях и заявках в друзья.

### Звонки

* WebRTC 1-на-1 аудиозвонки.
* WebRTC 1-на-1 видеозвонки.
* Поддержка TURN-сервера через Coturn.
* Переключение камеры.
* Включение и выключение микрофона.
* Включение и выключение камеры.

### Хранение файлов

* Локальное файловое хранилище.
* S3-compatible object storage.
* Поддержка MinIO для локальной разработки.

## Стек

### Frontend

* React 19
* TypeScript
* Vite
* Tailwind CSS 4

### Mobile

* React Native
* TypeScript
* React Native Firebase
* react-native-webrtc

### Backend

* Go 1.26
* Gin
* GORM
* PostgreSQL
* Redis
* WebSocket

### Security

* JWT Authentication
* HttpOnly Cookies
* CSRF Protection
* AES-256-GCM
* Server-side message encryption at rest
* Password Hashing

### Notifications

* Go
* Gin
* RabbitMQ
* PostgreSQL
* SSE
* Web Push (VAPID)
* Firebase Cloud Messaging (FCM)

### Infrastructure

* Docker
* Docker Compose
* Nginx
* Coturn (optional)

## Архитектура

```text
backend/        основной API, авторизация, пользователи, посты, чат, WebSocket
frontend/       React/Vite веб-клиент
mobile/         React Native Android-приложение
notifications/  сервис уведомлений
backend/init/   SQL инициализация PostgreSQL для backend-контейнера
packages/       shared TypeScript-типы и helpers
```

## Message Encryption

Личные сообщения поддерживают два режима: legacy server-side encryption / encryption at rest и client-side E2EE для диалогов, где у обоих участников есть E2EE backup/public key.

Особенности реализации:

* В legacy-режиме клиент отправляет обычный текст, backend шифрует его перед сохранением и расшифровывает перед отдачей клиенту.
* В client E2EE-режиме клиент отправляет `ciphertext`, `nonce`, `encryption_version = 1`; backend не расшифровывает payload.
* Новые E2EE-вложения шифруются на клиенте до upload, сохраняются как opaque `.bin`, а file key хранится только в `encrypted_file_key`.
* Старые вложения с `message_attachments.encryption_version = 0` остаются legacy и открываются как раньше.
* Для legacy encryption-at-rest и client E2EE payload используется AES-256-GCM; file/message keys заворачиваются клиентом через RSA-OAEP-SHA-256.

Важно:

`MESSAGE_ENCRYPTION_KEY` обязателен для production (`GIN_MODE=release`). Ключ должен быть base64-encoded 32 bytes и не должен логироваться или попадать в исходники. В local compose есть dev fallback только для локальной разработки, его нельзя использовать в production.

## Быстрый старт

### Локальная разработка

```bash
cp .env.local.example .env.local

docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  up -d --build
```

Остановка:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  down
```

Логи:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  logs -f
```

Доступные URL:

```text
Frontend:      http://localhost:5173
Backend API:   http://localhost:8080/health
Notifications: http://localhost:8085/health
RabbitMQ UI:   http://localhost:15672
MinIO Console: http://localhost:9001
```

## Production

Запуск production окружения:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Для TURN-сервера:

```bash
docker compose \
  -f docker-compose.prod.yml \
  --profile turn \
  up -d
```

## Проверка

Backend:

```bash
cd backend
go test ./...
```

Notifications:

```bash
cd notifications
go test ./...
```

Frontend:

```bash
cd frontend
npm run lint
npm run test
npm run build
```

Mobile:

```bash
cd mobile
npm ci
npx tsc --noEmit
npm run lint
npm test -- --runInBand
```

## Основные возможности проекта

* Full-stack приложение на Go + React + React Native.
* WebSocket чат в реальном времени.
* Server-side encryption-at-rest и client-side E2EE для чата/вложений.
* WebRTC аудио и видеозвонки.
* Push-уведомления.
* RabbitMQ.
* PostgreSQL + Redis.
* Docker-first инфраструктура.
* Поддержка S3-хранилищ.
* Android приложение.
