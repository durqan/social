# Social Frontend

Веб-клиент социальной сети на React, TypeScript, Vite и Tailwind CSS.

## Что есть в клиенте

- Авторизация, регистрация, выход и CSRF-интеграция с backend.
- Профили, поиск пользователей, друзья и заявки.
- Лента постов, комментарии и лайки.
- Реал-тайм чат через WebSocket.
- Уведомления через notifications service, SSE и Web Push.
- Аудиозвонки через WebRTC.

Контракт signaling для звонков описан в `../CALL_EVENTS.md`.

## Команды

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

## Переменные окружения

Vite читает переменные с префиксом `VITE_`:

```env
VITE_API_BASE_URL=/api
VITE_NOTIFICATIONS_URL=/notifications-api
VITE_VAPID_PUBLIC_KEY=
VITE_TURN_URLS=turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp
VITE_TURN_USERNAME=social_turn
VITE_TURN_CREDENTIAL=change_me_turn_password
```

В локальной разработке значения по умолчанию рассчитаны на Vite proxy и backend на `http://localhost:8080`. Для production маршрутизацию API и notifications выполняет nginx.
