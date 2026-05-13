# Social Network

Full-stack social network application with real-time chat, posts, comments, and user profiles.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Go, Gin, GORM, WebSocket
- **Database**: PostgreSQL
- **Deployment**: Docker, Docker Compose

## Features

- ✅ Authentication (HttpOnly cookies)
- ✅ User profiles with avatars and bio
- ✅ Posts wall with likes and comments
- ✅ Real-time private messaging with WebSocket
- ✅ Read receipts (✓/✓✓)
- ✅ Typing indicators
- ✅ Batch message deletion
- ✅ Mobile responsive sidebar
- ✅ Toast notifications

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Go 1.26+ (for local development)
- Node.js 20+ (for local development)

### Production Deployment

```bash
git clone https://github.com/your-username/social.git
cd social
cp .env.example .env
# Edit .env with your secure passwords
docker compose up -d