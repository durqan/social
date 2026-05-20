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

### Production

```bash
git clone https://github.com/durqan/social.git
cd social
cp .env.example .env
# Отредактируй .env (секреты!)
docker compose up -d