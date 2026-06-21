let activeConversationId: number | null = null;

export function setActivePushConversation(conversationId: number | null) {
  activeConversationId = Number.isFinite(conversationId)
    ? conversationId
    : null;
}

export function getActivePushConversation() {
  return activeConversationId;
}
