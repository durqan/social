import { apiRequest, toQueryString } from './http';
import type { CallIceCandidate, CallSessionDescription, CallType } from './ws';

export type ActiveCallStatus =
  | 'ringing'
  | 'answered'
  | 'accepted'
  | 'declined'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'failed'
  | 'replaced';

export type CallUser = {
  id: number;
  name: string;
  avatar?: string;
};

export type RestoredCallIceCandidate = CallIceCandidate & {
  from_id?: number;
  fromId?: number;
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
  offer?: CallSessionDescription;
  answer?: CallSessionDescription;
  ice_candidates?: RestoredCallIceCandidate[];
};

type ActiveCallResponse = {
  call: ActiveCall | null;
};

export const callsApi = {
  getCall(callId: string) {
    return apiRequest<ActiveCall>(`/calls/${encodeURIComponent(callId)}`);
  },

  async getActiveCall(callId?: string) {
    const query = toQueryString({ call_id: callId });
    const response = await apiRequest<ActiveCallResponse>(
      `/calls/active${query}`,
    );
    return response.call;
  },

  async acceptCallIntent(callId: string) {
    const response = await apiRequest<ActiveCallResponse>(
      `/calls/${encodeURIComponent(callId)}/accept`,
      { method: 'POST' },
    );
    return response.call;
  },

  rejectCall(callId: string) {
    return apiRequest<{ ok: boolean }>(
      `/calls/${encodeURIComponent(callId)}/reject`,
      { method: 'POST' },
    );
  },

  endCall(callId: string) {
    return apiRequest<{ ok: boolean }>(
      `/calls/${encodeURIComponent(callId)}/end`,
      { method: 'POST' },
    );
  },
};
