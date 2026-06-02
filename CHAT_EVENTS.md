# Chat WebSocket Events

Документ фиксирует текущий контракт chat WebSocket events для backend, web и mobile.

## Общий envelope

Все события передаются в одном формате:

```json
{
  "type": "message:new",
  "payload": {}
}
```

Клиенты должны игнорировать неизвестные события и неизвестные поля payload. Realtime events не являются source of truth: source of truth для сообщений остается backend DB.

## Message DTO

`message:new` и `message:update` используют один и тот же `Message` payload. Фактически backend сериализует `models.Message` после загрузки relations и преобразования attachment URLs в приватные URLs.

### Обязательные поля Message

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | number | ID сообщения. |
| `from_id` | number | ID отправителя. |
| `to_id` | number | ID получателя. |
| `content` | string | Текст сообщения. Может быть пустым, если есть вложение. |
| `is_read` | boolean | Прочитано ли сообщение получателем. |
| `created_at` | string | ISO/RFC3339 timestamp создания. |
| `updated_at` | string | ISO/RFC3339 timestamp последнего обновления. Backend отправляет поле; клиенты сохраняют backward compatibility, если оно отсутствует. |

### Опциональные поля Message

| Поле | Тип | Описание |
| --- | --- | --- |
| `from` | `MessageUser` | Данные отправителя, когда relation загружен backend. |
| `to` | `MessageUser` | Данные получателя, когда relation загружен backend. |
| `attachments` | `MessageAttachment[]` | Вложения сообщения. Может отсутствовать или быть пустым массивом. |
| `reply_to_message_id` | number \| null | ID сообщения, на которое отвечают. |
| `reply_to_message` | `Message` \| null | Превью сообщения-ответа, когда relation загружен. |
| `forwarded_from_message_id` | number \| null | ID исходного пересланного сообщения. |
| `forwarded_from_user_id` | number \| null | ID автора исходного пересланного сообщения. |
| `forwarded_from_message` | `Message` \| null | Превью исходного сообщения, когда relation загружен. |
| `forwarded_from_user` | `MessageUser` \| null | Автор исходного сообщения, когда relation загружен. |

### MessageUser

Обязательные поля: `id`, `name`, `email`.

Опциональные поля: `age`, `bio`, `avatar`, `avatar_position_x`, `avatar_position_y`, `avatar_scale`, `is_email_verified`, `created_at`.

Backend может отправить дополнительные поля модели пользователя. Клиенты должны их игнорировать, если они не используются.

### MessageAttachment

Обязательные поля: `file_url`, `file_type`, `size`.

Опциональные поля: `id`, `message_id`, `width`, `height`, `created_at`.

`file_type` сейчас фактически используется как `image`. `file_url` для сохраненных сообщений должен быть приватным URL вида `/api/messages/attachments/:id`.

### Пример Message JSON

```json
{
  "id": 123,
  "from_id": 1,
  "to_id": 2,
  "content": "Hello",
  "is_read": false,
  "created_at": "2026-06-02T12:00:00Z",
  "updated_at": "2026-06-02T12:00:00Z",
  "from": {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.com",
    "avatar": null,
    "avatar_position_x": 50,
    "avatar_position_y": 50,
    "avatar_scale": 1
  },
  "to": {
    "id": 2,
    "name": "Bob",
    "email": "bob@example.com",
    "avatar": null,
    "avatar_position_x": 50,
    "avatar_position_y": 50,
    "avatar_scale": 1
  },
  "attachments": [],
  "reply_to_message_id": null,
  "reply_to_message": null,
  "forwarded_from_message_id": null,
  "forwarded_from_user_id": null,
  "forwarded_from_message": null,
  "forwarded_from_user": null
}
```

## message:new

Sender: backend.

Receivers: web and mobile clients connected as the message sender or recipient.

When it happens: after a message is successfully created through HTTP send, HTTP forward, or WebSocket `message:send`.

Clients that must handle it: web, mobile.

Payload: `Message` DTO.

Required payload fields: all required `Message` fields.

Optional payload fields: all optional `Message` fields.

Example:

```json
{
  "type": "message:new",
  "payload": {
    "id": 123,
    "from_id": 1,
    "to_id": 2,
    "content": "Hello",
    "is_read": false,
    "created_at": "2026-06-02T12:00:00Z",
    "updated_at": "2026-06-02T12:00:00Z",
    "from": { "id": 1, "name": "Alice", "email": "alice@example.com" },
    "to": { "id": 2, "name": "Bob", "email": "bob@example.com" },
    "attachments": []
  }
}
```

Client behavior: add the message if it is absent. If a matching optimistic message exists, replace it with the persisted message. Do not create duplicates.

## message:update

Sender: backend.

Receivers: web and mobile clients connected as either participant in the conversation.

When it happens: after a message is successfully edited through HTTP `PATCH /messages/:messageId`.

Clients that must handle it: web, mobile.

Payload: updated `Message` DTO.

Required payload fields: all required `Message` fields.

Optional payload fields: all optional `Message` fields.

Example:

```json
{
  "type": "message:update",
  "payload": {
    "id": 123,
    "from_id": 1,
    "to_id": 2,
    "content": "Edited text",
    "is_read": false,
    "created_at": "2026-06-02T12:00:00Z",
    "updated_at": "2026-06-02T12:05:00Z",
    "from": { "id": 1, "name": "Alice", "email": "alice@example.com" },
    "to": { "id": 2, "name": "Bob", "email": "bob@example.com" },
    "attachments": []
  }
}
```

Client behavior: update an existing message by `id`. If the message is not present in the current local state, ignore the event. If both local and incoming messages have valid `updated_at`, ignore the incoming event when local `updated_at` is newer. If `updated_at` is missing or invalid on either side, keep backward-compatible behavior and apply the incoming update.

## message:delete

Sender: backend.

Receivers: web and mobile clients connected as either participant in the conversation.

When it happens: after a message is successfully deleted through HTTP delete or batch delete.

Clients that must handle it: web, mobile.

Payload fields:

| Поле | Обязательное | Тип | Описание |
| --- | --- | --- | --- |
| `message_id` | yes | number | ID удаленного сообщения. |

Example:

```json
{
  "type": "message:delete",
  "payload": {
    "message_id": 123
  }
}
```

Client behavior: remove an existing message by `message_id`. If the message is not present in local state, ignore the event.

## message:read

Sender: backend.

Receivers: web and mobile clients connected as either the reader or the original sender.

When it happens: after messages from `to_id` to `from_id` are marked as read through HTTP or WebSocket.

Clients that must handle it: web, mobile.

Payload fields:

| Поле | Обязательное | Тип | Описание |
| --- | --- | --- | --- |
| `from_id` | yes | number | User ID читателя. |
| `to_id` | yes | number | User ID отправителя сообщений, которые были прочитаны. |

Example:

```json
{
  "type": "message:read",
  "payload": {
    "from_id": 2,
    "to_id": 1
  }
}
```

Client behavior: mark local messages sent by `to_id` to `from_id` as read when they are present.

## message:error

Sender: backend.

Receivers: web and mobile clients connected as the user who caused the error.

When it happens: when a WebSocket chat command fails validation or is rejected before persistence.

Clients that must handle it: web, mobile.

Payload fields:

| Поле | Обязательное | Тип | Описание |
| --- | --- | --- | --- |
| `error` | yes | string | User-facing or loggable error message. |

Example:

```json
{
  "type": "message:error",
  "payload": {
    "error": "can only message accepted friends"
  }
}
```

Client behavior: show or store the error without mutating persisted chat state. If a client created an optimistic local message for the failed send, it should restore or clear that optimistic state according to its own send flow.
