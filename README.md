# Social Network

Full-stack социальная сеть с веб-клиентом, React Native Android-приложением, REST API, WebSocket-чатом, push-уведомлениями и 1-на-1 звонками.

## Возможности

- Авторизация через JWT и HttpOnly cookies, CSRF-защита и rate limiting.
- Профили пользователей: аватар, био, поиск, друзья, заявки и блокировки.
- Лента постов с комментариями, лайками и ограничением публикаций для неподтвержденной почты.
- Реал-тайм чат: приватные сообщения, вложения, индикаторы печати, прочтение и массовое удаление.
- Уведомления через RabbitMQ, SSE, Web Push и Android FCM.
- WebRTC 1-на-1 аудио/видеозвонки с опциональным TURN-сервером.
- Загрузка аватаров и картинок в локальное хранилище или S3-compatible object storage.
- Адаптивный React-интерфейс и отдельное React Native Android-приложение.

## Стек

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4.
- Mobile: React Native, TypeScript, React Native Firebase, react-native-webrtc.
- Backend: Go 1.26, Gin, GORM, PostgreSQL, Redis, WebSocket.
- Notifications: Go, Gin, PostgreSQL, RabbitMQ, SSE, Web Push/VAPID, FCM.
- Infrastructure: Docker, Docker Compose, Nginx, Certbot, optional Coturn.

## Структура

```text
backend/        основной API, auth, пользователи, посты, чат, WebSocket
frontend/       веб-клиент React/Vite и nginx-конфиги
mobile/         React Native Android app и APK-сборка
notifications/  сервис уведомлений и push-подписок
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

Эта команда поднимает PostgreSQL, Redis и RabbitMQ. RabbitMQ Management UI доступен на `http://localhost:15672` с логином `guest` и паролем `guest`.

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

Vite dev server открывается на `http://localhost:5173`. В разработке фронтенд проксирует backend, notifications и WebSocket-маршруты, поэтому nginx не нужен.

### Notifications

Если нужно тестировать отдельный сервис уведомлений локально:

```bash
cd notifications
go run .
```

Сервис слушает `http://localhost:8085`. Для Web Push заполните `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` и `VITE_VAPID_PUBLIC_KEY`. Для Android FCM заполните `FCM_PROJECT_ID` и один из вариантов credentials: `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`, `FIREBASE_SERVICE_ACCOUNT_JSON` или `GOOGLE_APPLICATION_CREDENTIALS`.

### Mobile

```bash
cd mobile
npm install
SOCIAL_API_BASE_URL=http://<LAN-IP>:8080 npm run start
```

При тестировании на телефоне используйте LAN IP машины, а не `localhost`.

Для APK-сборки через GitHub Actions задайте repository variable `SOCIAL_API_BASE_URL` и, если нужен FCM, secret `GOOGLE_SERVICES_JSON_BASE64`.

## Production

Подготовьте `.env` с production-значениями и запустите compose-файл:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Production compose поднимает PostgreSQL, Redis, RabbitMQ, backend, notifications, frontend/nginx и certbot. По умолчанию образы берутся из `ghcr.io/durqan/*`, но их можно переопределить переменными `BACKEND_IMAGE`, `FRONTEND_IMAGE`, `NOTIFICATIONS_IMAGE`.

Для WebRTC-звонков с TURN:

```bash
docker compose -f docker-compose.prod.yml --profile turn up -d
```

### Storage

По умолчанию backend использует локальное хранилище `uploads`. S3-compatible storage включается через:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<provider-endpoint>
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_PUBLIC_BASE_URL=https://<public-or-cdn-host>
S3_FORCE_PATH_STYLE=true
```

Если `S3_PUBLIC_BASE_URL` не задан, backend все равно умеет генерировать signed URL для приватной выдачи вложений, но публичные аватары лучше отдавать через public bucket/CDN URL.

## Проверка

```bash
cd backend && go test ./...
cd notifications && go test ./...
cd frontend && npm run lint && npm run build
cd mobile && npm ci && npx tsc --noEmit && npm run lint && npm test -- --runInBand
```

## Полезные команды

```bash
make dev-infra       # поднять локальную инфраструктуру
make stop-infra      # остановить локальную инфраструктуру
make dev-backend     # запустить основной Go API
make dev-frontend    # запустить Vite dev server
make dev-mobile      # запустить mobile dev flow
```
