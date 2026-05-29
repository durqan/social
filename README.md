# Social Network

Full-stack социальная сеть с веб-клиентом, мобильным Expo-клиентом, REST API, WebSocket-чатом, push-уведомлениями, аудиозвонками и комнатами совместного просмотра видео.

## Возможности

- Авторизация через JWT и HttpOnly cookies, CSRF-защита и rate limiting.
- Профили пользователей: аватар, био, поиск, друзья, заявки и блокировки.
- Лента постов с комментариями, лайками и ограничением публикаций для неподтвержденной почты.
- Реал-тайм чат: приватные сообщения, вложения, индикаторы печати, прочтение и массовое удаление.
- Уведомления через RabbitMQ, SSE и Web Push.
- WebRTC-аудиозвонки с опциональным TURN-сервером.
- Комнаты совместного просмотра видео с live-чатом.
- Адаптивный React-интерфейс и отдельное мобильное приложение на Expo.

## Стек

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4.
- Mobile: Expo, React Native, TypeScript.
- Backend: Go 1.26, Gin, GORM, PostgreSQL, Redis, WebSocket.
- Notifications: Go, Gin, PostgreSQL, RabbitMQ, SSE, Web Push/VAPID.
- Watcher: Go, Gin, WebSocket, in-memory комнаты.
- Infrastructure: Docker, Docker Compose, Nginx, Certbot, optional Coturn.

## Структура

```text
backend/        основной API, auth, пользователи, посты, чат, WebSocket
frontend/       веб-клиент React/Vite и nginx-конфиги
mobile/         Expo-клиент для Android/iOS
notifications/  сервис уведомлений и push-подписок
watcher/        сервис комнат совместного просмотра
init/           SQL/init-файлы для PostgreSQL
certbot/        данные Let's Encrypt для production
```

## Быстрый старт для разработки

### Требования

- Docker и Docker Compose.
- Go 1.26+.
- Node.js 20+.
- npm.

### Переменные окружения

Создайте локальный `.env` на основе примера:

```bash
cp .env.example .env
```

Для локального запуска backend напрямую с хоста проверьте `DATABASE_URL`: Postgres из `docker-compose.yml` опубликован на `localhost:5433`, поэтому строка подключения должна указывать на этот порт.

### Инфраструктура

```bash
make dev-infra
```

Эта команда поднимает PostgreSQL, Redis, RabbitMQ и watcher. RabbitMQ Management UI доступен на `http://localhost:15672` с логином `guest` и паролем `guest`.

### Backend

```bash
make dev-backend
```

API запускается на `http://localhost:8080`. Основные группы маршрутов: `/auth`, `/users`, `/posts`, `/messages`, `/ws`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite dev server открывается на `http://localhost:5173`. В разработке фронтенд проксирует backend, notifications, watcher и WebSocket-маршруты, поэтому nginx не нужен.

### Notifications

Если нужно тестировать отдельный сервис уведомлений локально:

```bash
cd notifications
go run .
```

Сервис слушает `http://localhost:8085`. Для push-уведомлений заполните `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` и `VITE_VAPID_PUBLIC_KEY`.

### Mobile

```bash
cd mobile
npm install
EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8080 npm run start
```

При тестировании на телефоне используйте LAN IP машины, а не `localhost`.

## Production

Подготовьте `.env` с production-значениями и запустите compose-файл:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Production compose поднимает PostgreSQL, Redis, RabbitMQ, backend, notifications, watcher, frontend/nginx и certbot. По умолчанию образы берутся из `ghcr.io/durqan/*`, но их можно переопределить переменными `BACKEND_IMAGE`, `FRONTEND_IMAGE`, `NOTIFICATIONS_IMAGE`, `WATCHER_IMAGE`.

Для WebRTC-звонков с TURN:

```bash
docker compose -f docker-compose.prod.yml --profile turn up -d
```

## Проверка

```bash
cd backend && go test ./...
cd notifications && go test ./...
cd watcher && go test ./...
cd frontend && npm run lint && npm run build
```

## Полезные команды

```bash
make dev-infra       # поднять локальную инфраструктуру
make stop-infra      # остановить локальную инфраструктуру
make dev-backend     # запустить основной Go API
make dev-frontend    # запустить Vite dev server
make dev-mobile      # запустить Expo
```
