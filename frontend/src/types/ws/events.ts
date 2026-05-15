import type { Message } from '../../types.js';

export interface BaseWsEvent<T extends string, P> {
    type: T;
    payload: P;
}

export type MessageEvent = BaseWsEvent<
    'message:new',
    Message
>;

export type TypingStartEvent = BaseWsEvent<
    'typing:start',
    {
        from_id: number;
    }
>;

export type TypingStopEvent = BaseWsEvent<
    'typing:stop',
    {
        from_id: number;
    }
>;

export type ReadReceiptEvent = BaseWsEvent<
    'message:read',
    {
        from_id: number;
        to_id: number;
    }
>;

export type MessageDeletedEvent = BaseWsEvent<
    'message:delete',
    {
        message_id: number;
    }
>;

export type FriendRequestEvent = BaseWsEvent<
    'friend:request',
    {
        from_id: number;
        from_name: string;
        message: string;
    }
>;

export type FriendAcceptedEvent = BaseWsEvent<
    'friend:accepted',
    {
        from_id: number;
        from_name: string;
        message: string;
    }
>;

export type WsEvent =
    | MessageEvent
    | TypingStartEvent
    | TypingStopEvent
    | ReadReceiptEvent
    | MessageDeletedEvent
    | FriendRequestEvent
    | FriendAcceptedEvent;