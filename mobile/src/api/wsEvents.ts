import type {
  Conversation,
  Message,
  PinnedMessage,
  ReactionSummary,
} from './domain';

export const WS_EVENTS = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_SEND: 'message:send',
  MESSAGE_UPDATE: 'message:update',
  MESSAGE_ERROR: 'message:error',
  MESSAGE_READ: 'message:read',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_REACTION: 'message:reaction',
  MESSAGE_PINNED: 'message_pinned',
  MESSAGE_UNPINNED: 'message_unpinned',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  CONVERSATION_ACTIVE: 'conversation:active',
  CONVERSATION_INACTIVE: 'conversation:inactive',
  CONVERSATION_READ: 'conversation:read',
  CONVERSATION_DELTA: 'conversation:delta',
  FRIEND_REQUEST: 'friend:request',
  FRIEND_ACCEPTED: 'friend:accepted',
  PRESENCE_UPDATE: 'presence:update',
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPTED: 'call:accepted',
  CALL_END: 'call:end',
  CALL_REJECT: 'call:reject',
  CALL_HEARTBEAT: 'call:heartbeat',
  CALL_TIMEOUT: 'call:timeout',
  CALL_BUSY: 'call:busy',
  CALL_REPLACED: 'call:replaced',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface BaseWsEvent<T extends string, P> {
  type: T;
  payload: P;
}

export type MessageEvent = BaseWsEvent<typeof WS_EVENTS.MESSAGE_NEW, Message>;
export type MessageUpdatedEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_UPDATE,
  Message
>;
export type MessageErrorEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_ERROR,
  {
    error: string;
  }
>;
export type TypingStartEvent = BaseWsEvent<
  typeof WS_EVENTS.TYPING_START,
  {
    from_id: number;
  }
>;
export type TypingStopEvent = BaseWsEvent<
  typeof WS_EVENTS.TYPING_STOP,
  {
    from_id: number;
  }
>;
export type ReadReceiptEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_READ,
  {
    from_id: number;
    to_id: number;
    conversation_id?: number;
  }
>;
export type ConversationReadEvent = BaseWsEvent<
  typeof WS_EVENTS.CONVERSATION_READ,
  {
    reader_id: number;
    conversation_id: number;
  }
>;
export type ConversationDeltaOperation = 'upsert' | 'remove';
export type ConversationDeltaEvent = BaseWsEvent<
  typeof WS_EVENTS.CONVERSATION_DELTA,
  {
    operation: ConversationDeltaOperation;
    peer_user_id: number;
    conversation_id: number;
    version: string;
    event_id: string;
    conversation?: Conversation | null;
  }
>;
export type MessageDeletedEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_DELETE,
  {
    message_id: number;
  }
>;
export type MessageReactionEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_REACTION,
  {
    message_id: number;
    conversation_id: number;
    reaction_version: number;
    reactions: ReactionSummary[];
  }
>;
export type MessagePinnedEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_PINNED,
  {
    pinned_message: PinnedMessage;
  }
>;
export type MessageUnpinnedEvent = BaseWsEvent<
  typeof WS_EVENTS.MESSAGE_UNPINNED,
  {
    conversation_id: number;
    message_id: number;
    participant_ids: number[];
  }
>;
export type FriendRequestEvent = BaseWsEvent<
  typeof WS_EVENTS.FRIEND_REQUEST,
  {
    from_id: number;
    from_name: string;
    message: string;
  }
>;
export type FriendAcceptedEvent = BaseWsEvent<
  typeof WS_EVENTS.FRIEND_ACCEPTED,
  {
    from_id: number;
    from_name: string;
    message: string;
  }
>;
export type PresenceUpdateEvent = BaseWsEvent<
  typeof WS_EVENTS.PRESENCE_UPDATE,
  {
    user_id: number;
    online: boolean;
    last_seen_at?: string | null;
  }
>;

export type NonCallWsEvent =
  | MessageEvent
  | MessageUpdatedEvent
  | MessageErrorEvent
  | TypingStartEvent
  | TypingStopEvent
  | ReadReceiptEvent
  | ConversationReadEvent
  | ConversationDeltaEvent
  | MessageDeletedEvent
  | MessageReactionEvent
  | MessagePinnedEvent
  | MessageUnpinnedEvent
  | FriendRequestEvent
  | FriendAcceptedEvent
  | PresenceUpdateEvent;

export type CallType = 'audio' | 'video';

export type CallIncomingEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_INCOMING,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallAcceptedEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_ACCEPTED,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallEndEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_END,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallRejectEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_REJECT,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallHeartbeatEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_HEARTBEAT,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallTimeoutEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_TIMEOUT,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallBusyEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_BUSY,
  {
    from_id: number;
    call_id: string;
  }
>;
export type CallReplacedEvent = BaseWsEvent<
  typeof WS_EVENTS.CALL_REPLACED,
  {
    from_id: number;
    call_id: string;
  }
>;

export type WsEvent =
  | NonCallWsEvent
  | CallIncomingEvent
  | CallAcceptedEvent
  | CallEndEvent
  | CallRejectEvent
  | CallHeartbeatEvent
  | CallTimeoutEvent
  | CallBusyEvent
  | CallReplacedEvent
  | {
      type: string;
      payload: unknown;
    };
