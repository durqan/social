# Social Network

**Современная full-stack социальная сеть** с реал-тайм чатом, лентой и удобным интерфейсом.

## ✨ Основные возможности

- 🔐 Авторизация (JWT + HttpOnly cookies)
- 👤 Профили с аватарками и био
- 📱 Лента постов с лайками и комментариями
- 💬 **Реал-тайм чат** (приватные сообщения)
    - Индикаторы печати
    - Галочки прочтения
    - Массовое удаление
- 🔔 Toast-уведомления
- 📱 Полностью адаптивный дизайн

## 🛠 Tech Stack

**Frontend**: React 19 + TypeScript + Vite + Tailwind CSS  
**Backend**: Go + Gin + GORM + WebSocket + **Redis**  
**Database**: PostgreSQL  
**Cache / Sessions**: **Redis**  
**Deployment**: Docker + Docker Compose

## 🚀 Быстрый старт

### Предварительные требования
- Docker и Docker Compose
- Go 1.26+ (для локальной разработки)
- Node.js 20+

### Локальная разработка без пересборки Docker

Docker используется только для Postgres и Redis:

```bash
make dev-infra
```

Backend запускается напрямую с хоста:

```bash
make dev-backend
```

Frontend запускается отдельно:

```bash
make dev-frontend
```

Локальные переменные лежат в `.env`; пример для новой машины есть в `.env.example`.
Frontend dev server проксирует `/api` и `/ws` на `http://localhost:8080`, поэтому nginx и Docker-сборка frontend для разработки не нужны.

### Production

```bash
git clone https://github.com/durqan/social.git
cd social
docker compose -f docker-compose.prod.yml up -d
```

Если нужен TURN-сервер для WebRTC:

```bash
docker compose -f docker-compose.prod.yml --profile turn up -d
```
