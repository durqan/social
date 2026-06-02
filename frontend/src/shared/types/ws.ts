import type { Message } from "@/shared/types/domain.js";

export interface BaseWsEvent<T extends string, P> {
    type: T;
    payload: P;
}

export type MessageEvent = BaseWsEvent<
    'message:new',
    Message
>;

export type MessageUpdatedEvent = BaseWsEvent<
    'message:update',
    Message
>;

export type MessageErrorEvent = BaseWsEvent<
    'message:error',
    {
        error: string;
    }
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

export interface PresenceUpdateEvent {
    type: 'presence:update';

    payload: {
        user_id: number;
        online: boolean;
    };
}

export type CallOfferEvent = BaseWsEvent<
    'call:offer',
    {
        from_id: number;
        call_id: string;
        call_type?: 'audio' | 'video';
        offer: RTCSessionDescriptionInit;
    }
>;

export type CallAnswerEvent = BaseWsEvent<
    'call:answer',
    {
        from_id: number;
        call_id: string;
        answer: RTCSessionDescriptionInit;
    }
>;

export type CallIceEvent = BaseWsEvent<
    'call:ice',
    {
        from_id: number;
        call_id: string;
        candidate: RTCIceCandidateInit;
    }
>;

export type CallEndEvent = BaseWsEvent<
    'call:end',
    {
        from_id: number;
        call_id: string;
    }
>;

export type CallRejectEvent = BaseWsEvent<
    'call:reject',
    {
        from_id: number;
        call_id: string;
    }
>;

export type WsEvent =
    | MessageEvent
    | MessageUpdatedEvent
    | MessageErrorEvent
    | TypingStartEvent
    | TypingStopEvent
    | ReadReceiptEvent
    | MessageDeletedEvent
    | FriendRequestEvent
    | FriendAcceptedEvent
    | PresenceUpdateEvent
    | CallOfferEvent
    | CallAnswerEvent
    | CallIceEvent
    | CallEndEvent
    | CallRejectEvent;
