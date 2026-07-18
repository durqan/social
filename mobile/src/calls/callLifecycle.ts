import { callsApi } from '../api/calls';
import { chatSocket, WS_EVENTS, type WsEvent } from '../api/ws';
import {
  clearPendingIncomingCall,
  consumePendingIncomingCall,
  rememberTerminalIncomingCall,
  subscribePendingIncomingCall,
} from '../notifications/pendingIncomingCall';
import { cancelIncomingCallNotification } from '../notifications/localNotifications';
import type { CallType } from './types';

type ShutdownCallHandler = () => Promise<void> | void;

export type CallLifecycleSignal = {
  kind: 'incoming' | 'accepted' | 'terminal';
  callID: string;
  peerName?: string;
};

type CallLifecycleListener = (signal: CallLifecycleSignal) => void;

let shutdownHandler: ShutdownCallHandler | null = null;

export const callLifecycle = {
  create(toID: number, callType: CallType) {
    return callsApi.createCall(toID, callType);
  },

  getActive(callID?: string) {
    return callsApi.getActiveCall(callID);
  },

  accept(callID: string) {
    return callsApi.acceptCall(callID);
  },

  credentials(callID: string) {
    return callsApi.getLiveKitCredentials(callID);
  },

  reject(callID: string) {
    return callsApi.rejectCall(callID);
  },

  end(callID: string) {
    return callsApi.endCall(callID);
  },

  heartbeat(peerID: number, callID: string) {
    return chatSocket.sendCallHeartbeat(peerID, callID);
  },

  async clearIncoming(callID: string) {
    await Promise.allSettled([
      cancelIncomingCallNotification(callID),
      clearPendingIncomingCall(callID),
    ]);
  },

  async markTerminal(callID: string) {
    await Promise.allSettled([
      rememberTerminalIncomingCall(callID),
      cancelIncomingCallNotification(callID),
    ]);
  },
};

export function subscribeCallLifecycle(listener: CallLifecycleListener) {
  const unsubscribeSocket = chatSocket.onMessage((event: WsEvent) => {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as { call_id?: unknown })
        : {};
    const callID =
      typeof payload.call_id === 'string' ? payload.call_id.trim() : '';
    if (!callID) {
      return;
    }

    if (event.type === WS_EVENTS.CALL_INCOMING) {
      listener({ kind: 'incoming', callID });
      return;
    }
    if (event.type === WS_EVENTS.CALL_ACCEPTED) {
      listener({ kind: 'accepted', callID });
      return;
    }
    if (
      event.type === WS_EVENTS.CALL_END ||
      event.type === WS_EVENTS.CALL_REJECT ||
      event.type === WS_EVENTS.CALL_TIMEOUT ||
      event.type === WS_EVENTS.CALL_BUSY ||
      event.type === WS_EVENTS.CALL_REPLACED
    ) {
      listener({ kind: 'terminal', callID });
    }
  });

  const unsubscribePush = subscribePendingIncomingCall(push => {
    listener({
      kind: 'incoming',
      callID: push.callId,
      peerName: push.callerName,
    });
  });
  consumePendingIncomingCall()
    .then(push => {
      if (push) {
        listener({
          kind: 'incoming',
          callID: push.callId,
          peerName: push.callerName,
        });
      }
    })
    .catch(() => undefined);

  return () => {
    unsubscribeSocket();
    unsubscribePush();
  };
}

export function registerCallShutdownHandler(handler: ShutdownCallHandler) {
  shutdownHandler = handler;
  return () => {
    if (shutdownHandler === handler) {
      shutdownHandler = null;
    }
  };
}

export async function shutdownCurrentCallForLogout() {
  await shutdownHandler?.();
}
