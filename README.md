# Social Network

Full-stack социальная сеть с веб-клиентом, React Native Android-приложением, REST API, WebSocket-чатом, push-уведомлениями, 1-на-1 звонками и сквозным шифрованием личных сообщений.

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

### Сквозное шифрование (E2EE)

* Сквозное шифрование личных сообщений.
* Сквозное шифрование вложений.
* Сервер не имеет доступа к содержимому зашифрованных сообщений.
* Сервер не имеет доступа к содержимому зашифрованных вложений.
* Локальное шифрование и расшифровка на стороне клиента.
* Восстановление E2EE-ключей после смены браузера или устройства.
* Совместимость со старыми сообщениями без шифрования.

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
* RSA-OAEP
* Argon2id
* End-to-End Encryption (E2EE)
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
* Certbot
* Coturn (optional)

## Архитектура

```text
backend/        основной API, авторизация, пользователи, посты, чат, WebSocket
frontend/       React/Vite веб-клиент
mobile/         React Native Android-приложение
notifications/  сервис уведомлений
init/           SQL инициализация PostgreSQL
certbot/        сертификаты Let's Encrypt
```

## End-to-End Encryption

Личные сообщения и вложения могут быть защищены сквозным шифрованием.

Особенности реализации:

* Шифрование выполняется только на стороне клиента.
* Сервер хранит только зашифрованные данные.
* Для шифрования сообщений используется AES-256-GCM.
* Для защиты ключей используется RSA-OAEP.
* Для резервного хранения ключей используется Argon2id.
* Поддерживается восстановление ключей после смены устройства или браузера.
* Сервер не может прочитать содержимое зашифрованных сообщений и вложений.

Важно:

Если пользователь потеряет пароль и доступ ко всем устройствам одновременно, восстановление E2EE-данных будет невозможно.

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
* Сквозное шифрование сообщений и вложений.
* WebRTC аудио и видеозвонки.
* Push-уведомления.
* RabbitMQ.
* PostgreSQL + Redis.
* Docker-first инфраструктура.
* Поддержка S3-хранилищ.
* Android приложение.
