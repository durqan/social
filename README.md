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
- Go 1.26+, Node.js 20+ и npm нужны только если запускаете backend/frontend вручную вне Docker.

### Локальный запуск через Docker Compose с hot reload

Первый запуск:

```bash
cp .env.local.example .env.local
docker compose --env-file .env.local -f docker-compose.local.yml up -d --build
```

Обычный запуск:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml up -d
```

Остановка без удаления данных:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml down
```

Полный сброс с удалением volumes:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml down -v --remove-orphans
```

Просмотр логов всех сервисов:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml logs -f
```

Логи конкретных сервисов:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml logs -f backend frontend notifications
```

Локальный compose поднимает PostgreSQL, Redis, RabbitMQ, MinIO, backend, notifications и frontend/Vite. Backend запускается через `air`, видит изменения из `./backend` через bind volume и автоматически пересобирает/перезапускает Go-сервер. Frontend запускается через Vite dev server командой `npm run dev -- --host 0.0.0.0`, видит изменения исходников через bind volume, а `node_modules` хранится в отдельном Docker volume `social_local_frontend_node_modules`.

Отдельного `watcher`-сервиса в репозитории нет: RabbitMQ consumer запускается внутри `notifications`. Данные PostgreSQL хранятся в volume `social_local_postgres_data` и сохраняются между перезапусками. Backend подключается к PostgreSQL и Redis по Docker DNS-именам `postgres` и `redis`.

Доступные URL:

```bash
frontend:      http://localhost:5173
backend API:   http://localhost:8080/health
notifications: http://localhost:8085/health
RabbitMQ UI:   http://localhost:15672
MinIO console: http://localhost:9001
```

Frontend в Docker работает через Vite proxy: браузер обращается к `http://localhost:5173/api`, а Vite внутри compose проксирует запросы на `http://backend:8080`. WebSocket `/ws` и notifications `/notifications-api` проксируются аналогично.

### Ручной запуск вне Docker

Создайте локальный `.env` на основе примера:

```bash
cp .env.example .env
```

Если backend/frontend запускаются с хоста, инфраструктуру удобнее держать в `docker-compose.local.yml`, а сами приложения запускать вручную. В `.env` для host-run оставьте `DATABASE_URL=postgres://social:social@localhost:5433/social?sslmode=disable`, `REDIS_HOST=localhost` и `RABBIT_URL=amqp://guest:guest@localhost:5672/`.

```bash
docker compose --env-file .env.local.example -f docker-compose.local.yml up -d postgres redis rabbitmq minio minio-create-bucket
cd backend && go run ./cmd/api
cd frontend && npm install && npm run dev
```

Если нужно тестировать отдельный сервис уведомлений вне Docker:

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

Для локальной разработки backend использует `STORAGE_DRIVER=local` и директорию `uploads`.
В production compose по умолчанию включен `STORAGE_DRIVER=s3`:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<provider-endpoint>
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_PUBLIC_BASE_URL=
S3_FORCE_PATH_STYLE=true
```

`S3_PUBLIC_BASE_URL` опционален и нужен только если вы осознанно отдаете файлы через публичный CDN/base URL. Для приватного bucket оставьте его пустым: backend отдает вложения и аватары через backend endpoints с signed redirect.

Для проверки S3 локально:

```bash
docker compose --env-file .env.local.example -f docker-compose.local.yml up -d minio minio-create-bucket
cd backend && STORAGE_DRIVER=s3 S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_BUCKET=social-local S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin S3_PUBLIC_BASE_URL= S3_FORCE_PATH_STYLE=true go run ./cmd/api
```

## Проверка

```bash
cd backend && go test ./...
cd notifications && go test ./...
cd frontend && npm run lint && npm run build
cd mobile && npm ci && npx tsc --noEmit && npm run lint && npm test -- --runInBand
```
