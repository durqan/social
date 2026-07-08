import type { Message } from '@social/shared';

import { getApiErrorMessage } from '../../../api/http';

function messageUpdateTime(message: Message) {
  if (!message.updated_at) {
    return null;
  }

  const time = Date.parse(message.updated_at);
  return Number.isFinite(time) ? time : null;
}

export function shouldApplyMessageUpdate(current: Message, updated: Message) {
  const currentTime = messageUpdateTime(current);
  const updatedTime = messageUpdateTime(updated);

  if (currentTime === null || updatedTime === null) {
    return true;
  }

  return updatedTime >= currentTime;
}

export function messageBelongsToChat(
  message: Message,
  currentUserId: number | undefined,
  otherUserId: number,
) {
  return (
    (message.from_id === otherUserId && message.to_id === currentUserId) ||
    (message.to_id === otherUserId && message.from_id === currentUserId)
  );
}

function mergeMessage(current: Message | undefined, next: Message) {
  if (!current) {
    return next;
  }

  if (!shouldApplyMessageUpdate(current, next)) {
    return current;
  }

  return {
    ...next,
    reactions: next.reactions ?? current.reactions,
    reaction_version: next.reaction_version ?? current.reaction_version,
  };
}

export function mergeMessageLists(current: Message[], next: Message[]) {
  const byId = new Map<number, Message>();
  current.forEach(message => {
    byId.set(message.id, message);
  });
  next.forEach(message => {
    byId.set(message.id, mergeMessage(byId.get(message.id), message));
  });

  return Array.from(byId.values()).sort((first, second) => {
    if (first.id !== second.id) {
      return first.id - second.id;
    }
    return Date.parse(first.created_at) - Date.parse(second.created_at);
  });
}

export function chatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'E2EE is not ready for this conversation' ||
      error.message === 'Recipient E2EE is not enabled'
    ) {
      return 'Не удалось отправить сообщение.';
    }
    if (error.message.includes('too large for safe on-device processing')) {
      return 'Вложение слишком большое для безопасной E2EE-обработки на устройстве. Выберите файл меньшего размера.';
    }
  }

  return getApiErrorMessage(error);
}
