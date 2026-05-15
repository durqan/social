import type { Message } from '../types.js';

export interface MessageEvent {
    type: 'message';

    payload: Message;
}

export interface TypingEvent {
    type: 'typing';

    payload: {
        from_id: number;
        is_typing: boolean;
    };
}

export interface ReadReceiptEvent {
    type: 'read_receipt';

    payload: {
        from_id: number;
        to_id: number;
    };
}

export interface MessageDeletedEvent {
    type: 'message_deleted';

    payload: {
        message_id: number;
    };
}

export interface FriendRequestEvent {
    type: 'friend_request';

    payload: {
        from_id: number;
        from_name: string;
        message: string;
    };
}

export interface FriendAcceptedEvent {
    type: 'friend_accepted';

    payload: {
        from_id: number;
        from_name: string;
        message: string;
    };
}

export type WsEvent =
    | MessageEvent
    | TypingEvent
    | ReadReceiptEvent
    | MessageDeletedEvent
    | FriendRequestEvent
    | FriendAcceptedEvent;