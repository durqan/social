import type { Conversation } from "../types/domain";
import type { ConversationDeltaEvent } from "../ws/events";

export type ConversationVersionMap = Map<number, string>;

function conversationTimestamp(conversation: Conversation) {
  const timestamp = Date.parse(conversation.last_message_at || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function conversationStableID(conversation: Conversation) {
  return Number(conversation.user_id) || 0;
}

function conversationSortID(conversation: Conversation) {
  const conversationID = Number(conversation.conversation_id);
  if (Number.isFinite(conversationID) && conversationID > 0) {
    return conversationID;
  }
  return Number(conversation.user_id) || 0;
}

export function compareConversations(
  first: Conversation,
  second: Conversation,
) {
  if (first.is_pinned !== second.is_pinned) {
    return first.is_pinned ? -1 : 1;
  }

  const timeDifference =
    conversationTimestamp(second) - conversationTimestamp(first);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return conversationSortID(second) - conversationSortID(first);
}

export function sortConversations(items: Conversation[]) {
  return [...items].sort(compareConversations);
}

export function appendConversationPage(
  current: Conversation[],
  page: Conversation[],
) {
  const existingPeers = new Set(current.map(item => item.user_id));
  const appended = page.filter(item => !existingPeers.has(item.user_id));
  return appended.length > 0 ? [...current, ...appended] : current;
}

function compareDecimalVersions(first: string, second: string) {
  const normalizedFirst = first.replace(/^0+/, "") || "0";
  const normalizedSecond = second.replace(/^0+/, "") || "0";
  if (normalizedFirst.length !== normalizedSecond.length) {
    return normalizedFirst.length > normalizedSecond.length ? 1 : -1;
  }
  return normalizedFirst === normalizedSecond
    ? 0
    : normalizedFirst > normalizedSecond
      ? 1
      : -1;
}

export function applyConversationDelta(
  current: Conversation[],
  event: ConversationDeltaEvent,
  versions?: ConversationVersionMap,
) {
  const peerID = Number(event.payload.peer_user_id);
  if (!Number.isFinite(peerID) || peerID <= 0) {
    return current;
  }

  const version = String(event.payload.version || "0");
  const previousVersion = versions?.get(peerID);
  if (
    previousVersion &&
    compareDecimalVersions(version, previousVersion) <= 0
  ) {
    return current;
  }
  versions?.set(peerID, version);

  if (event.payload.operation === "remove") {
    const next = current.filter(item => item.user_id !== peerID);
    return next.length === current.length ? current : next;
  }

  const conversation = event.payload.conversation;
  if (!conversation || Number(conversation.user_id) !== peerID) {
    return current;
  }

  const hydrated: Conversation = {
    ...conversation,
    conversation_id:
      Number(conversation.conversation_id) ||
      Number(event.payload.conversation_id) ||
      undefined,
  };
  const index = current.findIndex(item => item.user_id === peerID);
  if (index < 0) {
    return sortConversations([...current, hydrated]);
  }

  const next = [...current];
  next[index] = hydrated;
  return sortConversations(next);
}
