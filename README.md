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
* This is not end-to-end encryption.
* The backend can decrypt messages when serving them to authenticated clients.
* Клиент отправляет и получает обычный текст сообщений.
* Старые plaintext-сообщения с `encryption_version = 0` остаются читаемыми.
* E2EE endpoints and frontend crypto helpers are disabled/experimental and are not active for normal chat flow.

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

Личные сообщения защищаются server-side encryption / encryption at rest.

Особенности реализации:

* Клиент отправляет обычный текст сообщения.
* Backend шифрует текст перед сохранением в таблицу `messages`.
* В БД для новых текстовых сообщений хранится `ciphertext`, `nonce` и `encryption_version`, а `content` остается пустым.
* Backend расшифровывает сообщение перед отдачей клиенту.
* Это защищает содержимое сообщений при утечке БД.
* Это не защищает сообщения от backend-сервера или администратора с доступом к `MESSAGE_ENCRYPTION_KEY`.
* Для шифрования сообщений используется AES-256-GCM.
* E2EE-заготовки (`/e2ee/*`, key backup и frontend crypto helpers) сейчас disabled/experimental и не являются активной end-to-end encryption системой.

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
* Server-side encryption / encryption at rest для текстовых сообщений.
* WebRTC аудио и видеозвонки.
* Push-уведомления.
* RabbitMQ.
* PostgreSQL + Redis.
* Docker-first инфраструктура.
* Поддержка S3-хранилищ.
* Android приложение.
