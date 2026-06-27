import {
    WS_EVENTS,
    type BaseWsEvent,
    type NonCallWsEvent,
} from '@social/shared';

export {
    WS_EVENTS,
    type BaseWsEvent,
    type ConversationReadEvent,
    type FriendAcceptedEvent,
    type FriendRequestEvent,
    type MessageDeletedEvent,
    type MessageErrorEvent,
    type MessageEvent,
    type MessagePinnedEvent,
    type MessageReactionEvent,
    type MessageUnpinnedEvent,
    type MessageUpdatedEvent,
    type PresenceUpdateEvent,
    type ReadReceiptEvent,
    type TypingStartEvent,
    type TypingStopEvent,
} from '@social/shared';

export type CallOfferEvent = BaseWsEvent<
    typeof WS_EVENTS.CALL_OFFER,
    {
        from_id: number;
        call_id: string;
        event_id?: string;
        event_seq?: number;
        call_type?: 'audio' | 'video';
        offer: RTCSessionDescriptionInit;
    }
>;

export type CallAnswerEvent = BaseWsEvent<
    typeof WS_EVENTS.CALL_ANSWER,
    {
        from_id: number;
        call_id: string;
        event_id?: string;
        event_seq?: number;
        answer: RTCSessionDescriptionInit;
    }
>;

export type CallIceEvent = BaseWsEvent<
    typeof WS_EVENTS.CALL_ICE,
    {
        from_id: number;
        call_id: string;
        event_id?: string;
        event_seq?: number;
        candidate: RTCIceCandidateInit;
    }
>;

export type CallEndEvent = BaseWsEvent<
    typeof WS_EVENTS.CALL_END,
    {
        from_id: number;
        call_id: string;
        event_id?: string;
        event_seq?: number;
    }
>;

export type CallRejectEvent = BaseWsEvent<
    typeof WS_EVENTS.CALL_REJECT,
    {
        from_id: number;
        call_id: string;
        event_id?: string;
        event_seq?: number;
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
    | CallOfferEvent
    | CallAnswerEvent
    | CallIceEvent
    | CallEndEvent
    | CallRejectEvent
    | CallTimeoutEvent
    | CallBusyEvent
    | CallReplacedEvent;
