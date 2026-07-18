import { apiRequest, toQueryString } from './http';
import type { CallType } from './ws';
import {
  callError,
  callLog,
  describeCallError,
} from '../utils/callDiagnostics';

export type ActiveCallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'timeout'
  | 'ended'
  | 'failed'
  | 'replaced';

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
  accepted_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  created_at: string;
  caller?: CallUser;
  callee?: CallUser;
};

export type LiveKitCredentials = {
  server_url: string;
  token: string;
};

type ActiveCallResponse = {
  call: ActiveCall | null;
};

function summarizeCall(call: ActiveCall | null | undefined) {
  if (!call) {
    return { hasCall: false };
  }

  return {
    hasCall: true,
    callId: call.call_id,
    status: call.status,
    callerId: call.caller_id,
    calleeId: call.callee_id,
    callType: call.call_type,
  };
}

async function callApiRequest<T>(
  operation: string,
  method: string,
  path: string,
  request: () => Promise<T>,
  summarizeResponse: (response: T) => unknown,
) {
  callLog('CALL_API', 'request', { operation, method, path });
  try {
    const response = await request();
    callLog('CALL_API', 'response', {
      operation,
      method,
      path,
      ...((summarizeResponse(response) as Record<string, unknown>) ?? {}),
    });
    return response;
  } catch (error) {
    callError('CALL_ERROR', 'call api failed', {
      operation,
      method,
      path,
      error: describeCallError(error),
    });
    throw error;
  }
}

export const callsApi = {
  async createCall(toId: number, callType: CallType) {
    const path = '/calls';
    const response = await callApiRequest(
      'create_call',
      'POST',
      path,
      () =>
        apiRequest<ActiveCallResponse>(path, {
          method: 'POST',
          body: {
            to_id: toId,
            call_type: callType,
          },
        }),
      payload => summarizeCall(payload.call),
    );
    return response.call;
  },

  getCall(callId: string) {
    const path = `/calls/${encodeURIComponent(callId)}`;
    return callApiRequest(
      'get_call',
      'GET',
      path,
      () => apiRequest<ActiveCall>(path),
      response => summarizeCall(response),
    );
  },

  async getActiveCall(callId?: string) {
    const query = toQueryString({ call_id: callId });
    const path = `/calls/active${query}`;
    const response = await callApiRequest(
      'get_active_call',
      'GET',
      path,
      () => apiRequest<ActiveCallResponse>(path),
      payload => summarizeCall(payload.call),
    );
    return response.call;
  },

  async acceptCall(callId: string) {
    const path = `/calls/${encodeURIComponent(callId)}/accept`;
    const response = await callApiRequest(
      'accept_call',
      'POST',
      path,
      () =>
        apiRequest<ActiveCallResponse>(path, {
          method: 'POST',
        }),
      payload => summarizeCall(payload.call),
    );
    return response.call;
  },

  getLiveKitCredentials(callId: string) {
    const path = `/calls/${encodeURIComponent(callId)}/token`;
    return callApiRequest(
      'get_livekit_token',
      'POST',
      path,
      () =>
        apiRequest<LiveKitCredentials>(path, {
          method: 'POST',
        }),
      response => ({
        serverUrl: response.server_url,
        hasToken: Boolean(response.token),
      }),
    );
  },

  rejectCall(callId: string) {
    const path = `/calls/${encodeURIComponent(callId)}/reject`;
    return callApiRequest(
      'reject_call',
      'POST',
      path,
      () =>
        apiRequest<{ ok: boolean }>(path, {
          method: 'POST',
        }),
      response => ({ ok: response.ok }),
    );
  },

  endCall(callId: string) {
    const path = `/calls/${encodeURIComponent(callId)}/end`;
    return callApiRequest(
      'end_call',
      'POST',
      path,
      () =>
        apiRequest<{ ok: boolean }>(path, {
          method: 'POST',
        }),
      response => ({ ok: response.ok }),
    );
  },
};
