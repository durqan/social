import type { Message } from '../types.js';

export type TypingEvent = {
    type: 'typing';
    from_id: number;
    is_typing: boolean;
};

export type ReadReceiptEvent = {
    type: 'read_receipt';
    from_id: number;
    to_id: number;
};

export type MessageDeletedEvent = {
    type: 'message_deleted';
    message_id: number;
};

export type FriendRequestEvent = {
    type: 'friend_request';
    from_id: number;
    from_name: string;
    message: string;
};

export type FriendAcceptedEvent = {
    type: 'friend_accepted';
    from_id: number;
    from_name: string;
    message: string;
};

export type WsEvent =
    | Message
    | TypingEvent
    | ReadReceiptEvent
    | MessageDeletedEvent
    | FriendRequestEvent
    | FriendAcceptedEvent;

export const isMessageEvent = (event: WsEvent): event is Message => {
    return 'id' in event && 'from_id' in event && 'to_id' in event && 'content' in event;
};

export const isTypedEvent = <T extends WsEvent['type']>(
    event: WsEvent,
    type: T
): event is Extract<WsEvent, { type: T }> => {
    return 'type' in event && event.type === type;
};
