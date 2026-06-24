import { request } from "@/shared/api/axios.js";
import type { CallType } from "@/features/call/types.js";

export type ActiveCallStatus =
    | 'ringing'
    | 'answered'
    | 'accepted'
    | 'declined'
    | 'rejected'
    | 'missed'
    | 'ended'
    | 'failed';

export type CallUser = {
    id: number;
    name: string;
    avatar?: string;
};

export type ActiveCall = {
    call_id: string;
    conversation_id?: number;
    caller_id: number;
    callee_id: number;
    call_type: CallType;
    status: ActiveCallStatus;
    started_at: string;
    expires_at?: string;
    created_at: string;
    caller?: CallUser;
    callee?: CallUser;
    offer?: RTCSessionDescriptionInit;
    ice_candidates?: RTCIceCandidateInit[];
};

type ActiveCallResponse = {
    call: ActiveCall | null;
};

export const callService = {
    getCall(callId: string): Promise<ActiveCall> {
        return request.get<ActiveCall>(`/calls/${encodeURIComponent(callId)}`);
    },

    async getActiveCall(callId?: string): Promise<ActiveCall | null> {
        const query = callId ? `?call_id=${encodeURIComponent(callId)}` : '';
        const response = await request.get<ActiveCallResponse>(`/calls/active${query}`);
        return response.call;
    },
};
