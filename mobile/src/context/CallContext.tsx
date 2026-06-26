import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  Video,
  VideoOff,
} from 'lucide-react-native';
import {
  mediaDevices,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView,
  type MediaStream,
} from 'react-native-webrtc';
import { WS_EVENTS } from '@social/shared';

import { callsApi, type ActiveCall } from '../api/calls';
import { userApi } from '../api/users';
import {
  chatSocket,
  type CallIceCandidate,
  type CallSessionDescription,
  type CallType,
  type WsEvent,
} from '../api/ws';
import { TURN_CREDENTIAL, TURN_URLS, TURN_USERNAME } from '../config/env';
import { useAppLifecycle } from './AppLifecycleContext';
import { useAuth } from './AuthContext';
import {
  consumePendingIncomingCall,
  subscribePendingIncomingCall,
  type PendingIncomingCallPush,
} from '../notifications/pendingIncomingCall';
import { cancelIncomingCallNotification } from '../notifications/localNotifications';
import { logDev, warnDev } from '../utils/logger';
import { registerCallShutdownHandler } from './callLifecycle';

type CallStatus =
  | 'idle'
  | 'incoming'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'reconnecting'
  | 'ended'
  | 'error';

type CallContextValue = {
  status: CallStatus;
  peerUserId: number | null;
  startAudioCall: (toId: number, peerName?: string) => Promise<void>;
  startVideoCall: (toId: number, peerName?: string) => Promise<void>;
};

type PendingOffer = {
  fromId: number;
  callId: string;
  offer: CallSessionDescription;
  callType: CallType;
};

type PeerConnection = InstanceType<typeof RTCPeerConnection>;
type PeerConnectionEventTarget = {
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  removeEventListener?: (
    type: string,
    handler: (event: unknown) => void,
  ) => void;
};
type PeerConnectionHandlers = {
  onicecandidate?: ((event: unknown) => void) | null;
  ontrack?: ((event: unknown) => void) | null;
  onconnectionstatechange?: ((event: unknown) => void) | null;
  oniceconnectionstatechange?: ((event: unknown) => void) | null;
  onicegatheringstatechange?: ((event: unknown) => void) | null;
  onsignalingstatechange?: ((event: unknown) => void) | null;
};

const CallContext = createContext<CallContextValue | undefined>(undefined);
const disconnectedCleanupDelayMs = 10000;
const maxIceRecoveryAttempts = 2;

function createCallId() {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function callEventDedupKey(event: WsEvent) {
  const payload = event.payload as {
    from_id?: unknown;
    call_id?: unknown;
    event_id?: unknown;
  };
  if (!isCallId(payload.call_id)) {
    return null;
  }
  if (typeof payload.event_id === 'string' && payload.event_id.trim()) {
    return `${payload.call_id}:${payload.event_id.trim()}`;
  }
  if (event.type === WS_EVENTS.CALL_ICE) {
    return null;
  }
  return `${payload.call_id}:${event.type}:${String(payload.from_id ?? '')}`;
}

function iceServers() {
  const servers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }> = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (TURN_URLS.length > 0) {
    if (!TURN_USERNAME || !TURN_CREDENTIAL) {
      warnDev(
        '[SocialMobile] TURN URLs configured without username or credential',
      );
    }

    servers.push({
      urls: TURN_URLS,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }

  return servers;
}

async function requestCallPermissions(callType: CallType) {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (callType === 'video') {
    permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  }

  try {
    const result = await PermissionsAndroid.requestMultiple(permissions);
    const denied = permissions.filter(
      permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED,
    );

    if (denied.length > 0) {
      warnDev('[SocialMobile] Call permissions denied', {
        callType,
        denied,
      });
      return false;
    }

    return true;
  } catch (error) {
    warnDev('[SocialMobile] Failed to request call permissions', error);
    return false;
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => {
    try {
      track.stop();
    } catch (error) {
      warnDev('[SocialMobile] Failed to stop media track', error);
    }
  });

  try {
    stream?.release?.(true);
  } catch (error) {
    warnDev('[SocialMobile] Failed to release media stream', error);
  }
}

function showCallError(message: string) {
  Alert.alert('Звонок', message);
}

function iceCandidateType(candidate: CallIceCandidate) {
  return candidate.candidate.match(/\btyp\s+(\w+)/)?.[1] ?? 'unknown';
}

function isUsableIceCandidate(
  candidate: CallIceCandidate | null | undefined,
): candidate is CallIceCandidate {
  return (
    typeof candidate?.candidate === 'string' &&
    candidate.candidate.trim().length > 0
  );
}

async function addIceCandidateSafely(
  pc: PeerConnection,
  candidate: CallIceCandidate | null | undefined,
  context: string,
) {
  if (!isUsableIceCandidate(candidate)) {
    logDev('[SocialMobile] Skipping empty ICE candidate', { context });
    return;
  }

  try {
    logDev('[SocialMobile] Adding ICE candidate', {
      context,
      type: iceCandidateType(candidate),
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    });
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    warnDev('[SocialMobile] Failed to add ICE candidate', {
      context,
      error,
      candidate,
    });
  }
}

function logPeerState(pc: PeerConnection, callId: string, event: string) {
  logDev('[SocialMobile] Call peer state', {
    callId,
    event,
    signalingState: pc.signalingState,
    iceGatheringState: pc.iceGatheringState,
    iceConnectionState: pc.iceConnectionState,
    connectionState: pc.connectionState,
  });
}

function logIceServers(servers: ReturnType<typeof iceServers>, callId: string) {
  logDev('[SocialMobile] Creating call peer connection', {
    callId,
    iceServers: servers.map(server => ({
      urls: server.urls,
      hasUsername: Boolean(server.username),
      hasCredential: Boolean(server.credential),
    })),
  });
}

function statusText(status: CallStatus, callType: CallType) {
  if (status === 'incoming') {
    return callType === 'video' ? 'Входящий видеозвонок' : 'Входящий звонок';
  }
  if (status === 'connecting') {
    return 'Соединяем звонок';
  }
  if (status === 'ringing') {
    return 'Ждем ответа';
  }
  if (status === 'active') {
    return callType === 'video' ? 'Видеозвонок идет' : 'Звонок идет';
  }
  if (status === 'reconnecting') {
    return 'Восстанавливаем соединение';
  }
  if (status === 'ended') {
    return 'Звонок завершен';
  }
  if (status === 'error') {
    return 'Не удалось выполнить звонок';
  }
  return '';
}

const allowedCallTransitions: Record<CallStatus, ReadonlySet<CallStatus>> = {
  idle: new Set(['idle', 'incoming', 'connecting']),
  incoming: new Set(['incoming', 'connecting', 'ended', 'error', 'idle']),
  connecting: new Set(['connecting', 'ringing', 'active', 'ended', 'error', 'idle']),
  ringing: new Set(['ringing', 'active', 'ended', 'error', 'idle']),
  active: new Set(['active', 'reconnecting', 'ended', 'error', 'idle']),
  reconnecting: new Set(['reconnecting', 'active', 'ended', 'error', 'idle']),
  ended: new Set(['ended', 'idle']),
  error: new Set(['error', 'idle']),
};

function allowCallTransition(from: CallStatus, to: CallStatus) {
  return allowedCallTransitions[from]?.has(to) ?? false;
}

function callErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Не удалось выполнить звонок. Попробуйте позже.';
  }

  if (error.name === 'NotAllowedError') {
    return 'Нет доступа к камере или микрофону.';
  }

  if (error.name === 'NotFoundError') {
    return 'Камера или микрофон не найдены.';
  }

  if (error.name === 'NotReadableError') {
    return 'Камера или микрофон уже используются другим приложением.';
  }

  if (error.message === 'call audio permission denied') {
    return 'Разрешите доступ к микрофону, чтобы начать звонок.';
  }

  if (
    error.message === 'call video permissions denied' ||
    error.message === 'call permissions denied'
  ) {
    return 'Разрешите доступ к микрофону и камере, чтобы начать звонок.';
  }

  if (error.message === 'call audio track missing') {
    return 'Микрофон не вернул аудиодорожку.';
  }

  if (error.message === 'call video track missing') {
    return 'Камера не вернула видеодорожку.';
  }

  if (error.message === 'WebSocket is not connected') {
    return 'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.';
  }

  return 'Не удалось выполнить звонок. Попробуйте позже.';
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { appState, resumeCount } = useAppLifecycle();
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType>('audio');
  const [peerUserId, setPeerUserId] = useState<number | null>(null);
  const [peerName, setPeerName] = useState('Пользователь');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef(status);
  const peerUserIdRef = useRef(peerUserId);
  const callTypeRef = useRef(callType);
  const pcRef = useRef<PeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pendingOfferRef = useRef<PendingOffer | null>(null);
  const pendingIncomingCallPushRef = useRef<PendingIncomingCallPush | null>(
    null,
  );
  const hydratingCallIdsRef = useRef(new Set<string>());
  const hydratingActiveRef = useRef(false);
  const pendingIceRef = useRef<CallIceCandidate[]>([]);
  const seenCallEventsRef = useRef(new Set<string>());
  const acceptInFlightRef = useRef(false);
  const iceRecoveryAttemptsRef = useRef(0);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pcListenerCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    peerUserIdRef.current = peerUserId;
  }, [peerUserId]);

  useEffect(() => {
    callTypeRef.current = callType;
  }, [callType]);

  const setCallStatus = useCallback((nextStatus: CallStatus, reason = 'state_update') => {
    const currentStatus = statusRef.current;
    if (!allowCallTransition(currentStatus, nextStatus)) {
      warnDev('[SocialMobile] Invalid call state transition ignored', {
        from: currentStatus,
        to: nextStatus,
        reason,
        callId: callIdRef.current,
      });
      return false;
    }

    if (currentStatus !== nextStatus) {
      logDev('[SocialMobile] Call state transition', {
        from: currentStatus,
        to: nextStatus,
        reason,
        callId: callIdRef.current,
      });
    }

    statusRef.current = nextStatus;
    setStatus(nextStatus);
    return true;
  }, []);

  const setCallPeer = useCallback((nextPeerUserId: number | null) => {
    peerUserIdRef.current = nextPeerUserId;
    setPeerUserId(nextPeerUserId);
  }, []);

  const setCurrentCallType = useCallback((nextCallType: CallType) => {
    callTypeRef.current = nextCallType;
    setCallType(nextCallType);
  }, []);

  const clearEndTimer = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const closePeerConnection = useCallback(() => {
    clearDisconnectTimer();
    pcListenerCleanupRef.current?.();
    pcListenerCleanupRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, [clearDisconnectTimer]);

  const resetCall = useCallback(() => {
    const callId = callIdRef.current;

    if (callId) {
      chatSocket.discardPendingCallEvents(callId);
      cancelIncomingCallNotification(callId).catch(() => undefined);
    }

    clearEndTimer();
    closePeerConnection();
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    stopStream(remoteStreamRef.current);
    remoteStreamRef.current = null;
    callIdRef.current = null;
    pendingOfferRef.current = null;
    pendingIncomingCallPushRef.current = null;
    pendingIceRef.current = [];
    acceptInFlightRef.current = false;
    iceRecoveryAttemptsRef.current = 0;
    setLocalStream(null);
    setRemoteStream(null);
    setMicrophoneOn(true);
    setCameraOn(true);
    setCurrentCallType('audio');
    setCallPeer(null);
    setPeerName('Пользователь');
    setError(null);
    setCallStatus('idle', 'reset');
  }, [
    clearEndTimer,
    closePeerConnection,
    setCallPeer,
    setCallStatus,
    setCurrentCallType,
  ]);

  const finishCall = useCallback(
    (
      nextStatus: CallStatus = 'ended',
      message?: string,
      notifyPeer = false,
    ) => {
      const callId = callIdRef.current;
      const targetId = peerUserIdRef.current ?? pendingOfferRef.current?.fromId;

      if (callId) {
        chatSocket.discardPendingCallEvents(callId);
        cancelIncomingCallNotification(callId).catch(() => undefined);
      }

      if (notifyPeer && targetId && callId) {
        try {
          chatSocket.sendCallEnd(targetId, callId);
        } catch (sendError) {
          warnDev('[SocialMobile] Failed to send call:end during cleanup', {
            callId,
            sendError,
          });
        }
      }

      clearEndTimer();
      closePeerConnection();
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      stopStream(remoteStreamRef.current);
      remoteStreamRef.current = null;
      callIdRef.current = null;
      pendingOfferRef.current = null;
      pendingIncomingCallPushRef.current = null;
      pendingIceRef.current = [];
      acceptInFlightRef.current = false;
      iceRecoveryAttemptsRef.current = 0;
      setLocalStream(null);
      setRemoteStream(null);
      setMicrophoneOn(true);
      setCameraOn(true);
      setError(message ?? null);
      setCallStatus(nextStatus, 'finish');
      endTimerRef.current = setTimeout(resetCall, 1800);
    },
    [clearEndTimer, closePeerConnection, resetCall, setCallStatus],
  );

  const loadPeerName = useCallback(
    async (userId: number, fallback?: string) => {
      if (fallback) {
        setPeerName(fallback);
        return;
      }

      try {
        const profile = await userApi.getUser(userId);
        setPeerName(profile.name || 'Пользователь');
      } catch {
        setPeerName('Пользователь');
      }
    },
    [],
  );

  const showHydratedIncomingCall = useCallback(
    async (call: ActiveCall, fallbackName?: string) => {
      if (
        !user?.id ||
        call.status !== 'ringing' ||
        call.callee_id !== user.id
      ) {
        return;
      }

      if (call.caller_id === user.id || statusRef.current !== 'idle') {
        return;
      }

      pendingOfferRef.current = call.offer
        ? {
            fromId: call.caller_id,
            callId: call.call_id,
            offer: call.offer,
            callType: call.call_type === 'video' ? 'video' : 'audio',
          }
        : null;
      pendingIceRef.current = call.ice_candidates ?? [];
      pendingIncomingCallPushRef.current = null;
      callIdRef.current = call.call_id;
      setCallPeer(call.caller_id);
      setCurrentCallType(call.call_type === 'video' ? 'video' : 'audio');
      setError(null);
      setCallStatus('incoming');
      await loadPeerName(call.caller_id, fallbackName ?? call.caller?.name);
    },
    [loadPeerName, setCallPeer, setCallStatus, setCurrentCallType, user?.id],
  );

  const hydrateIncomingCall = useCallback(
    async (callId?: string | null, fallbackName?: string) => {
      if (!user?.id) {
        return;
      }

      const normalizedCallId = callId?.trim();
      if (normalizedCallId) {
        if (
          callIdRef.current === normalizedCallId &&
          statusRef.current === 'incoming' &&
          pendingOfferRef.current
        ) {
          return;
        }
        if (hydratingCallIdsRef.current.has(normalizedCallId)) {
          return;
        }
        hydratingCallIdsRef.current.add(normalizedCallId);
      } else {
        if (hydratingActiveRef.current) {
          return;
        }
        hydratingActiveRef.current = true;
      }

      try {
        const call = normalizedCallId
          ? await callsApi.getActiveCall(normalizedCallId)
          : await callsApi.getActiveCall();
        if (call) {
          await showHydratedIncomingCall(call, fallbackName);
        }
      } catch (hydrateError) {
        warnDev('[SocialMobile] Failed to hydrate incoming call', hydrateError);
      } finally {
        if (normalizedCallId) {
          hydratingCallIdsRef.current.delete(normalizedCallId);
        } else {
          hydratingActiveRef.current = false;
        }
      }
    },
    [showHydratedIncomingCall, user?.id],
  );

  const stagePendingIncomingCallPush = useCallback(
    (call: PendingIncomingCallPush) => {
      if (
        !user?.id ||
        call.callerId === user.id ||
        statusRef.current !== 'idle'
      ) {
        return;
      }

      pendingIncomingCallPushRef.current = call;
      chatSocket.connect();
      hydrateIncomingCall(call.callId, call.callerName).catch(() => undefined);
      logDev('[SocialMobile] Pending incoming call push staged', {
        callId: call.callId,
        callerId: call.callerId,
        conversationId: call.conversationId,
      });
    },
    [hydrateIncomingCall, user?.id],
  );

  const openLocalStream = useCallback(async (nextCallType: CallType) => {
    const permissionsGranted = await requestCallPermissions(nextCallType);
    if (!permissionsGranted) {
      throw new Error(
        nextCallType === 'video'
          ? 'call video permissions denied'
          : 'call audio permission denied',
      );
    }

    let stream: MediaStream | null = null;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: true,
        video:
          nextCallType === 'video'
            ? {
                facingMode: 'user',
                width: 1280,
                height: 720,
                frameRate: 30,
              }
            : false,
      });

      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      if (audioTracks.length === 0) {
        stopStream(stream);
        throw new Error('call audio track missing');
      }

      if (nextCallType === 'video' && videoTracks.length === 0) {
        stopStream(stream);
        throw new Error('call video track missing');
      }

      logDev('[SocialMobile] Local call stream opened', {
        callType: nextCallType,
        audioTracks: audioTracks.length,
        videoTracks: videoTracks.length,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicrophoneOn(true);
      setCameraOn(videoTracks.length > 0);
      return stream;
    } catch (streamError) {
      if (stream) {
        stopStream(stream);
      }

      warnDev('[SocialMobile] Failed to open local call stream', streamError);
      throw streamError;
    }
  }, []);

  const openLocalStreamWithFallback = useCallback(
    async (nextCallType: CallType) => {
      try {
        return {
          stream: await openLocalStream(nextCallType),
          callType: nextCallType,
        };
      } catch (streamError) {
        if (nextCallType !== 'video') {
          throw streamError;
        }
        warnDev('[SocialMobile] Video stream failed, falling back to audio', {
          error: streamError,
          callId: callIdRef.current,
        });
        return {
          stream: await openLocalStream('audio'),
          callType: 'audio' as CallType,
        };
      }
    },
    [openLocalStream],
  );

  const flushPendingIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) {
      return;
    }

    const pending = pendingIceRef.current.splice(0);
    pendingIceRef.current = [];
    for (const candidate of pending) {
      await addIceCandidateSafely(pc, candidate, 'pending');
    }
  }, []);

  const createPeerConnection = useCallback(
    (toId: number, callId: string) => {
      closePeerConnection();

      const servers = iceServers();
      logIceServers(servers, callId);
      const pc = new RTCPeerConnection({
        iceServers: servers,
      });
      const eventTarget = pc as unknown as PeerConnectionEventTarget;
      const peerHandlers = pc as unknown as PeerConnectionHandlers;
      const isCurrentConnection = () =>
        pcRef.current === pc && callIdRef.current === callId;

      const updateRemoteStream = (stream: MediaStream) => {
        if (remoteStreamRef.current && remoteStreamRef.current !== stream) {
          stopStream(remoteStreamRef.current);
        }
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
      };

      const handleIceCandidate = (event: unknown) => {
        if (!isCurrentConnection()) {
          return;
        }

        const candidate = (
          event as {
            candidate?: { toJSON: () => CallIceCandidate } | null;
          }
        ).candidate;
        if (!candidate) {
          logPeerState(pc, callId, 'icecandidate:end');
          return;
        }

        try {
          const payload = candidate.toJSON();
          if (!isUsableIceCandidate(payload)) {
            logDev('[SocialMobile] Skipping empty outgoing ICE candidate', {
              callId,
            });
            return;
          }

          logDev('[SocialMobile] Sending ICE candidate', {
            callId,
            toId,
            type: iceCandidateType(payload),
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
          });
          chatSocket.sendCallIce(toId, payload, callId);
        } catch (sendError) {
          warnDev('[SocialMobile] Failed to send ICE candidate', sendError);
        }
      };

      const handleTrack = (event: unknown) => {
        if (!isCurrentConnection()) {
          return;
        }

        const track = (event as { track?: { kind?: string } | null }).track;
        const [stream] = (event as { streams?: MediaStream[] }).streams ?? [];
        logDev('[SocialMobile] Remote track event', {
          callId,
          trackKind: track?.kind,
          streamCount:
            (event as { streams?: MediaStream[] }).streams?.length ?? 0,
        });

        if (stream) {
          updateRemoteStream(stream);
        }
      };

      const handlePeerStateChange = (eventName: string) => {
        if (!isCurrentConnection()) {
          return;
        }

        logPeerState(pc, callId, eventName);

        const isConnected =
          pc.connectionState === 'connected' ||
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed';

        if (isConnected) {
          clearDisconnectTimer();
          iceRecoveryAttemptsRef.current = 0;
          setCallStatus('active', 'peer_connected');
        }

        const isDisconnected =
          pc.connectionState === 'disconnected' ||
          pc.iceConnectionState === 'disconnected';

        if (isDisconnected && !disconnectTimerRef.current) {
          setCallStatus('reconnecting', 'peer_disconnected');
          const restartIce = (pc as PeerConnection & { restartIce?: () => void })
            .restartIce;
          if (iceRecoveryAttemptsRef.current < maxIceRecoveryAttempts) {
            iceRecoveryAttemptsRef.current += 1;
            try {
              restartIce?.call(pc);
              logDev('[SocialMobile] ICE restart requested', {
                callId,
                attempt: iceRecoveryAttemptsRef.current,
              });
            } catch (restartError) {
              warnDev('[SocialMobile] ICE restart failed', {
                callId,
                restartError,
              });
            }
          }

          disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;

            const stillDisconnected =
              pc.connectionState === 'disconnected' ||
              pc.iceConnectionState === 'disconnected';

            if (pcRef.current === pc && callIdRef.current === callId && stillDisconnected) {
              if (iceRecoveryAttemptsRef.current < maxIceRecoveryAttempts) {
                handlePeerStateChange('ice-recovery-timeout');
                return;
              }
              finishCall('error', 'Соединение звонка прервано.', true);
            }
          }, disconnectedCleanupDelayMs);
        }

        const hasFailed =
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed' ||
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'closed';

        if (hasFailed) {
          if (
            pc.connectionState !== 'closed' &&
            pc.iceConnectionState !== 'closed' &&
            iceRecoveryAttemptsRef.current < maxIceRecoveryAttempts
          ) {
            clearDisconnectTimer();
            setCallStatus('reconnecting', 'peer_failed_recovering');
            iceRecoveryAttemptsRef.current += 1;
            try {
              (pc as PeerConnection & { restartIce?: () => void }).restartIce?.();
              logDev('[SocialMobile] ICE restart requested after failure', {
                callId,
                attempt: iceRecoveryAttemptsRef.current,
              });
              return;
            } catch (restartError) {
              warnDev('[SocialMobile] ICE restart after failure failed', {
                callId,
                restartError,
              });
            }
          }
          finishCall('error', 'Соединение звонка прервано.', true);
        }
      };

      const handleConnectionStateChange = () =>
        handlePeerStateChange('connectionstatechange');
      const handleIceConnectionStateChange = () =>
        handlePeerStateChange('iceconnectionstatechange');
      const handleIceGatheringStateChange = () =>
        logPeerState(pc, callId, 'icegatheringstatechange');
      const handleSignalingStateChange = () =>
        logPeerState(pc, callId, 'signalingstatechange');

      pcRef.current = pc;
      eventTarget.addEventListener('icecandidate', handleIceCandidate);
      eventTarget.addEventListener('track', handleTrack);
      eventTarget.addEventListener(
        'connectionstatechange',
        handleConnectionStateChange,
      );
      eventTarget.addEventListener(
        'iceconnectionstatechange',
        handleIceConnectionStateChange,
      );
      eventTarget.addEventListener(
        'icegatheringstatechange',
        handleIceGatheringStateChange,
      );
      eventTarget.addEventListener(
        'signalingstatechange',
        handleSignalingStateChange,
      );
      peerHandlers.onicecandidate = handleIceCandidate;
      peerHandlers.ontrack = handleTrack;
      peerHandlers.onconnectionstatechange = handleConnectionStateChange;
      peerHandlers.oniceconnectionstatechange = handleIceConnectionStateChange;
      peerHandlers.onicegatheringstatechange = handleIceGatheringStateChange;
      peerHandlers.onsignalingstatechange = handleSignalingStateChange;
      pcListenerCleanupRef.current = () => {
        eventTarget.removeEventListener?.('icecandidate', handleIceCandidate);
        eventTarget.removeEventListener?.('track', handleTrack);
        eventTarget.removeEventListener?.(
          'connectionstatechange',
          handleConnectionStateChange,
        );
        eventTarget.removeEventListener?.(
          'iceconnectionstatechange',
          handleIceConnectionStateChange,
        );
        eventTarget.removeEventListener?.(
          'icegatheringstatechange',
          handleIceGatheringStateChange,
        );
        eventTarget.removeEventListener?.(
          'signalingstatechange',
          handleSignalingStateChange,
        );
        if (peerHandlers.onicecandidate === handleIceCandidate) {
          peerHandlers.onicecandidate = null;
        }
        if (peerHandlers.ontrack === handleTrack) {
          peerHandlers.ontrack = null;
        }
        if (
          peerHandlers.onconnectionstatechange === handleConnectionStateChange
        ) {
          peerHandlers.onconnectionstatechange = null;
        }
        if (
          peerHandlers.oniceconnectionstatechange ===
          handleIceConnectionStateChange
        ) {
          peerHandlers.oniceconnectionstatechange = null;
        }
        if (
          peerHandlers.onicegatheringstatechange ===
          handleIceGatheringStateChange
        ) {
          peerHandlers.onicegatheringstatechange = null;
        }
        if (
          peerHandlers.onsignalingstatechange === handleSignalingStateChange
        ) {
          peerHandlers.onsignalingstatechange = null;
        }
      };

      return pc;
    },
    [clearDisconnectTimer, closePeerConnection, finishCall, setCallStatus],
  );

  const startCall = useCallback(
    async (toId: number, name: string | undefined, nextCallType: CallType) => {
      if (!user?.id || statusRef.current !== 'idle') {
        return;
      }

      clearEndTimer();
      setError(null);
      const callId = createCallId();
      callIdRef.current = callId;
      setCallPeer(toId);
      setPeerName(name || 'Пользователь');
      setCurrentCallType(nextCallType);
      setCallStatus('connecting');

      try {
        const isCurrentStart = () =>
          callIdRef.current === callId &&
          peerUserIdRef.current === toId &&
          statusRef.current !== 'idle' &&
          statusRef.current !== 'ended' &&
          statusRef.current !== 'error';
        const cleanupStaleStart = (
          stream: MediaStream | null,
          pc?: PeerConnection,
        ) => {
          if (pc) {
            if (pcRef.current === pc) {
              closePeerConnection();
            } else {
              pc.close();
            }
          }

          if (stream) {
            stopStream(stream);
            if (localStreamRef.current === stream) {
              localStreamRef.current = null;
              setLocalStream(null);
            }
          }
        };

        chatSocket.connect();
        const { stream, callType: effectiveCallType } =
          await openLocalStreamWithFallback(nextCallType);
        if (!isCurrentStart()) {
          cleanupStaleStart(stream);
          return;
        }
        setCurrentCallType(effectiveCallType);

        const pc = createPeerConnection(toId, callId);
        if (!isCurrentStart()) {
          cleanupStaleStart(stream, pc);
          return;
        }

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        const offer = (await pc.createOffer()) as CallSessionDescription;
        if (!isCurrentStart()) {
          cleanupStaleStart(stream, pc);
          return;
        }

        await pc.setLocalDescription(new RTCSessionDescription(offer));
        if (!isCurrentStart()) {
          cleanupStaleStart(stream, pc);
          return;
        }

        const socketReady = await chatSocket.waitUntilConnected(8000);
        if (!isCurrentStart()) {
          cleanupStaleStart(stream, pc);
          return;
        }
        if (!socketReady) {
          throw new Error('WebSocket is not connected');
        }

        logDev('[SocialMobile] Sending call offer', {
          callId,
          toId,
          callType: effectiveCallType,
        });
        const offerSent = chatSocket.sendCallOffer(
          toId,
          offer,
          effectiveCallType,
          callId,
        );
        if (!offerSent) {
          throw new Error('WebSocket is not connected');
        }
        setCallStatus('ringing', 'offer_sent');
      } catch (callError) {
        const message = callErrorMessage(callError);
        showCallError(message);
        finishCall('error', message);
      }
    },
    [
      clearEndTimer,
      closePeerConnection,
      createPeerConnection,
      finishCall,
      openLocalStreamWithFallback,
      setCallPeer,
      setCallStatus,
      setCurrentCallType,
      user?.id,
    ],
  );

  const startAudioCall = useCallback(
    (toId: number, name?: string) => startCall(toId, name, 'audio'),
    [startCall],
  );

  const startVideoCall = useCallback(
    (toId: number, name?: string) => startCall(toId, name, 'video'),
    [startCall],
  );

  const acceptCall = useCallback(async () => {
    if (acceptInFlightRef.current) {
      return;
    }
    const pendingOffer = pendingOfferRef.current;
    if (!pendingOffer) {
      const callId = callIdRef.current;
      if (callId) {
        setError('Восстанавливаем соединение звонка...');
        chatSocket.connect();
        hydrateIncomingCall(callId).catch(() => undefined);
      }
      return;
    }

    setCallStatus('connecting');
    setError(null);
    acceptInFlightRef.current = true;

    let stream: MediaStream | null = null;
    let pc: PeerConnection | null = null;
    const isCurrentAccept = () =>
      user?.id &&
      callIdRef.current === pendingOffer.callId &&
      pendingOfferRef.current?.callId === pendingOffer.callId &&
      pendingOfferRef.current?.fromId === pendingOffer.fromId &&
      peerUserIdRef.current === pendingOffer.fromId &&
      statusRef.current !== 'idle' &&
      statusRef.current !== 'ended' &&
      statusRef.current !== 'error';
    const cleanupStaleAccept = () => {
      if (pc) {
        if (pcRef.current === pc) {
          closePeerConnection();
        } else {
          pc.close();
        }
      }
      if (stream) {
        stopStream(stream);
        if (localStreamRef.current === stream) {
          localStreamRef.current = null;
          setLocalStream(null);
        }
      }
    };

    try {
      await callsApi.acceptCallIntent(pendingOffer.callId);
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      const opened = await openLocalStreamWithFallback(pendingOffer.callType);
      stream = opened.stream;
      setCurrentCallType(opened.callType);
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      callIdRef.current = pendingOffer.callId;
      pc = createPeerConnection(pendingOffer.fromId, pendingOffer.callId);
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      const activeStream = stream;
      const activePc = pc;
      activeStream
        .getTracks()
        .forEach(track => activePc.addTrack(track, activeStream));

      await activePc.setRemoteDescription(
        new RTCSessionDescription(pendingOffer.offer),
      );
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      await flushPendingIce();
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }

      const answer = (await activePc.createAnswer()) as CallSessionDescription;
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      await activePc.setLocalDescription(new RTCSessionDescription(answer));
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      const socketReady = await chatSocket.waitUntilConnected(8000);
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      if (!socketReady) {
        throw new Error('WebSocket is not connected');
      }

      logDev('[SocialMobile] Sending call answer', {
        callId: pendingOffer.callId,
        toId: pendingOffer.fromId,
        callType: opened.callType,
      });
      const answerSent = chatSocket.sendCallAnswer(
        pendingOffer.fromId,
        answer,
        pendingOffer.callId,
      );
      if (!answerSent) {
        throw new Error('WebSocket is not connected');
      }
      pendingOfferRef.current = null;
      setCallStatus('active', 'answer_sent');
    } catch (callError) {
      if (!isCurrentAccept()) {
        cleanupStaleAccept();
        return;
      }
      try {
        chatSocket.sendCallReject(pendingOffer.fromId, pendingOffer.callId);
      } catch {
        // Ignore socket failures while leaving the failed call state.
      }
      const message = callErrorMessage(callError);
      showCallError(message);
      finishCall('error', message);
    } finally {
      acceptInFlightRef.current = false;
    }
  }, [
    closePeerConnection,
    createPeerConnection,
    finishCall,
    flushPendingIce,
    hydrateIncomingCall,
    openLocalStreamWithFallback,
    setCurrentCallType,
    setCallStatus,
    user?.id,
  ]);

  const rejectCall = useCallback(() => {
    const targetId = peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
    const callId = callIdRef.current ?? pendingOfferRef.current?.callId;
    if (targetId && callId) {
      try {
        chatSocket.sendCallReject(targetId, callId);
      } catch {
        // Socket can already be closed; local cleanup still matters.
      }
    }
    finishCall('ended');
  }, [finishCall]);

  const endCall = useCallback(() => {
    const targetId = peerUserIdRef.current;
    const callId = callIdRef.current;
    if (targetId && callId) {
      try {
        chatSocket.sendCallEnd(targetId, callId);
      } catch {
        // Socket can already be closed; local cleanup still matters.
      }
    }
    finishCall('ended');
  }, [finishCall]);

  useEffect(() => {
    return registerCallShutdownHandler(async () => {
      const callId = callIdRef.current ?? pendingOfferRef.current?.callId;
      const targetId = peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
      const currentStatus = statusRef.current;
      if (!callId || !targetId || currentStatus === 'idle') {
        resetCall();
        return;
      }

      try {
        if (currentStatus === 'incoming') {
          await callsApi.rejectCall(callId);
        } else {
          await callsApi.endCall(callId);
        }
      } catch {
        try {
          chatSocket.connect();
          await chatSocket.waitUntilConnected(1200);
          if (currentStatus === 'incoming') {
            chatSocket.sendCallReject(targetId, callId);
          } else {
            chatSocket.sendCallEnd(targetId, callId);
          }
        } catch {
          // Logout cleanup is best-effort; local media cleanup must still happen.
        }
      }

      resetCall();
    });
  }, [resetCall]);

  const toggleMicrophone = useCallback(() => {
    const next = !microphoneOn;
    localStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = next;
    });
    setMicrophoneOn(next);
  }, [microphoneOn]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach(track => {
      track.enabled = next;
    });
    setCameraOn(next);
  }, [cameraOn]);

  const switchCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks()[0]?._switchCamera();
  }, []);

  const handleSocketEvent = useCallback(
    (event: WsEvent) => {
      if (
        event.type !== WS_EVENTS.CALL_OFFER &&
        event.type !== WS_EVENTS.CALL_ANSWER &&
        event.type !== WS_EVENTS.CALL_ICE &&
        event.type !== WS_EVENTS.CALL_END &&
        event.type !== WS_EVENTS.CALL_REJECT &&
        event.type !== WS_EVENTS.CALL_TIMEOUT &&
        event.type !== WS_EVENTS.CALL_BUSY &&
        event.type !== WS_EVENTS.CALL_REPLACED
      ) {
        return;
      }

      const dedupKey = callEventDedupKey(event);
      if (dedupKey) {
        if (seenCallEventsRef.current.has(dedupKey)) {
          logDev('[SocialMobile] Duplicate call signaling event ignored', {
            type: event.type,
            dedupKey,
          });
          return;
        }
        seenCallEventsRef.current.add(dedupKey);
        if (seenCallEventsRef.current.size > 300) {
          seenCallEventsRef.current = new Set(
            Array.from(seenCallEventsRef.current).slice(-150),
          );
        }
      }

      if (event.type === WS_EVENTS.CALL_OFFER) {
        const payload = event.payload as {
          from_id: number;
          call_id?: string;
          offer: CallSessionDescription;
          call_type?: CallType;
        };
        const {
          from_id: fromId,
          call_id: callId,
          offer,
          call_type: incomingType,
        } = payload;

        if (fromId === user?.id || !isCallId(callId)) {
          return;
        }

        if (statusRef.current !== 'idle') {
          if (
            statusRef.current === 'incoming' &&
            callIdRef.current === callId
          ) {
            const nextCallType = incomingType === 'video' ? 'video' : 'audio';
            const matchingPushCall =
              pendingIncomingCallPushRef.current?.callId === callId
                ? pendingIncomingCallPushRef.current
                : null;
            pendingIncomingCallPushRef.current = null;
            pendingOfferRef.current = {
              fromId,
              callId,
              offer,
              callType: nextCallType,
            };
            setCallPeer(fromId);
            setCurrentCallType(nextCallType);
            loadPeerName(fromId, matchingPushCall?.callerName).catch(
              () => undefined,
            );
            return;
          }

          try {
            chatSocket.sendCallReject(fromId, callId);
          } catch {
            // Ignore busy reject failures.
          }
          logDev('[SocialMobile] Rejected incoming call while busy', {
            callId,
            fromId,
            status: statusRef.current,
          });
          return;
        }

        const nextCallType = incomingType === 'video' ? 'video' : 'audio';
        const matchingPushCall =
          pendingIncomingCallPushRef.current?.callId === callId
            ? pendingIncomingCallPushRef.current
            : null;
        if (matchingPushCall) {
          pendingIncomingCallPushRef.current = null;
        }
        pendingOfferRef.current = {
          fromId,
          callId,
          offer,
          callType: nextCallType,
        };
        callIdRef.current = callId;
        setCallPeer(fromId);
        setCurrentCallType(nextCallType);
        setCallStatus('incoming');
        logDev('[SocialMobile] Incoming call offer received', {
          callId,
          fromId,
          callType: nextCallType,
        });
        loadPeerName(fromId, matchingPushCall?.callerName).catch(
          () => undefined,
        );
        return;
      }

      const payload = event.payload as {
        from_id: number;
        call_id?: string;
        answer?: CallSessionDescription;
        candidate?: CallIceCandidate;
      };

      if (!isCallId(payload.call_id) || payload.call_id !== callIdRef.current) {
        return;
      }

      if (payload.from_id === user?.id) {
        if (!pcRef.current || statusRef.current === 'incoming') {
          finishCall('ended');
        }
        return;
      }

      const currentPeerId =
        peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
      if (payload.from_id !== currentPeerId) {
        return;
      }

      if (event.type === WS_EVENTS.CALL_ANSWER) {
        const pc = pcRef.current;
        if (!payload.answer || !pc) {
          return;
        }

        logDev('[SocialMobile] Call answer received', {
          callId: payload.call_id,
          fromId: payload.from_id,
        });
        const callId = payload.call_id;
        pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
          .then(async () => {
            logPeerState(pc, callId, 'remote-answer-set');
            await flushPendingIce();
            setCallStatus('active');
          })
          .catch(callError => {
            const message = callErrorMessage(callError);
            showCallError(message);
            finishCall('error', message, true);
          });
        return;
      }

      if (event.type === WS_EVENTS.CALL_ICE) {
        const candidate = payload.candidate;
        if (!isUsableIceCandidate(candidate)) {
          logDev('[SocialMobile] Skipping empty incoming ICE candidate', {
            callId: payload.call_id,
            fromId: payload.from_id,
          });
          return;
        }

        const pc = pcRef.current;
        if (!pc?.remoteDescription) {
          logDev(
            '[SocialMobile] Queuing ICE candidate until remoteDescription',
            {
              callId: payload.call_id,
              fromId: payload.from_id,
              type: iceCandidateType(candidate),
            },
          );
          pendingIceRef.current.push(candidate);
          return;
        }

        addIceCandidateSafely(pc, candidate, 'live').catch(() => undefined);
        return;
      }

      if (
        event.type === WS_EVENTS.CALL_TIMEOUT ||
        event.type === WS_EVENTS.CALL_BUSY ||
        event.type === WS_EVENTS.CALL_REPLACED
      ) {
        const terminalMessage =
          event.type === WS_EVENTS.CALL_BUSY
            ? 'Пользователь занят.'
            : event.type === WS_EVENTS.CALL_TIMEOUT
              ? 'Звонок не был принят.'
              : 'Звонок заменен новым вызовом.';
        logDev('[SocialMobile] Server terminal call event received', {
          callId: payload.call_id,
          fromId: payload.from_id,
          eventType: event.type,
        });
        finishCall('ended', terminalMessage);
        return;
      }

      if (
        event.type === WS_EVENTS.CALL_END ||
        statusRef.current !== 'active'
      ) {
        logDev('[SocialMobile] Remote call ended or rejected', {
          callId: payload.call_id,
          fromId: payload.from_id,
          eventType: event.type,
        });
        finishCall('ended');
      }
    },
    [
      finishCall,
      flushPendingIce,
      loadPeerName,
      setCallPeer,
      setCallStatus,
      setCurrentCallType,
      user?.id,
    ],
  );

  useEffect(() => {
    if (!user?.id) {
      resetCall();
      return undefined;
    }

    const unsubscribe = chatSocket.onMessage(handleSocketEvent);
    chatSocket.connect();
    return () => {
      unsubscribe();
    };
  }, [handleSocketEvent, resetCall, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let mounted = true;
    hydrateIncomingCall().catch(() => undefined);
    consumePendingIncomingCall()
      .then(call => {
        if (mounted && call) {
          stagePendingIncomingCallPush(call);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [
    hydrateIncomingCall,
    resumeCount,
    stagePendingIncomingCallPush,
    user?.id,
  ]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    return subscribePendingIncomingCall(stagePendingIncomingCallPush);
  }, [stagePendingIncomingCallPush, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    return chatSocket.onStatus(connected => {
      if (connected) {
        hydrateIncomingCall().catch(() => undefined);
      }
    });
  }, [hydrateIncomingCall, user?.id]);

  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      appState === 'active' ||
      callTypeRef.current !== 'video' ||
      (statusRef.current !== 'active' && statusRef.current !== 'reconnecting')
    ) {
      return;
    }

    localStreamRef.current?.getVideoTracks().forEach(track => {
      track.enabled = false;
    });
    setCameraOn(false);
    setCurrentCallType('audio');
    logDev('[SocialMobile] Video call degraded to audio in background', {
      callId: callIdRef.current,
      appState,
    });
  }, [appState, setCurrentCallType]);

  useEffect(
    () => () => {
      resetCall();
    },
    [resetCall],
  );

  const value = useMemo(
    () => ({
      status,
      peerUserId,
      startAudioCall,
      startVideoCall,
    }),
    [peerUserId, startAudioCall, startVideoCall, status],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay
        status={status}
        callType={callType}
        peerName={peerName}
        localStream={localStream}
        remoteStream={remoteStream}
        microphoneOn={microphoneOn}
        cameraOn={cameraOn}
        error={error}
        onAccept={acceptCall}
        onReject={rejectCall}
        onEnd={endCall}
        onToggleMicrophone={toggleMicrophone}
        onToggleCamera={toggleCamera}
        onSwitchCamera={switchCamera}
      />
    </CallContext.Provider>
  );
}

function CallOverlay({
  status,
  callType,
  peerName,
  localStream,
  remoteStream,
  microphoneOn,
  cameraOn,
  error,
  onAccept,
  onReject,
  onEnd,
  onToggleMicrophone,
  onToggleCamera,
  onSwitchCamera,
}: {
  status: CallStatus;
  callType: CallType;
  peerName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  microphoneOn: boolean;
  cameraOn: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (status === 'idle') {
    return null;
  }

  const showVideo = callType === 'video' && remoteStream;
  const showLocalPreview = callType === 'video' && localStream;
  const showActiveControls =
    status === 'connecting' ||
    status === 'ringing' ||
    status === 'active' ||
    status === 'reconnecting';
  const initial = peerName.slice(0, 1).toUpperCase();

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen">
      <View style={styles.callRoot}>
        <View style={styles.callGlowTop} />
        <View style={styles.callGlowBottom} />

        <View
          style={[
            styles.callHeader,
            { paddingTop: Math.max(insets.top, 28) + 22 },
          ]}
        >
          <Text style={styles.callName} numberOfLines={1}>
            {peerName}
          </Text>
          <Text style={styles.callStatus}>
            {error ?? statusText(status, callType)}
          </Text>
        </View>

        <View style={styles.remoteStage}>
          {showVideo ? (
            <RTCView
              streamURL={remoteStream.toURL()}
              style={styles.remoteVideo}
              objectFit="cover"
            />
          ) : (
            <View style={styles.audioStage}>
              <View style={styles.avatarPulse} />
              <View style={styles.peerAvatar}>
                <Text style={styles.peerInitial}>{initial}</Text>
              </View>
              {status === 'connecting' || status === 'reconnecting' ? (
                <ActivityIndicator color="#2563eb" size="large" />
              ) : null}
            </View>
          )}

          {showLocalPreview ? (
            <View style={styles.localPreview}>
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.localVideo}
                mirror
                objectFit="cover"
              />
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.callControls,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          {status === 'incoming' ? (
            <View style={styles.incomingControlsRow}>
              <CallButton
                label="Отклонить"
                icon={PhoneOff}
                danger
                large
                onPress={onReject}
              />
              <CallButton
                label="Ответить"
                icon={Phone}
                accept
                large
                onPress={onAccept}
              />
            </View>
          ) : null}

          {showActiveControls ? (
            <>
              <View style={styles.callButtonsRow}>
                <CallButton
                  label={microphoneOn ? 'Микрофон' : 'Выкл.'}
                  icon={microphoneOn ? Mic : MicOff}
                  muted={!microphoneOn}
                  onPress={onToggleMicrophone}
                />
                {callType === 'video' ? (
                  <>
                    <CallButton
                      label={cameraOn ? 'Камера' : 'Выкл.'}
                      icon={cameraOn ? Video : VideoOff}
                      muted={!cameraOn}
                      onPress={onToggleCamera}
                    />
                    <CallButton
                      label="Сменить"
                      icon={RotateCcw}
                      onPress={onSwitchCamera}
                    />
                  </>
                ) : null}
              </View>
              <CallButton
                label="Завершить"
                icon={PhoneOff}
                danger
                large
                onPress={onEnd}
              />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function CallButton({
  label,
  icon: Icon,
  danger,
  accept,
  muted,
  large,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<{
    color?: string;
    size?: number;
    strokeWidth?: number;
  }>;
  danger?: boolean;
  accept?: boolean;
  muted?: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  const iconColor = danger || accept ? '#ffffff' : '#0f172a';

  return (
    <View style={styles.callButtonWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.callButton,
          large && styles.callButtonLarge,
          danger && styles.callButtonDanger,
          accept && styles.callButtonAccept,
          muted && styles.callButtonMuted,
          pressed && styles.callButtonPressed,
        ]}
        onPress={onPress}
      >
        <Icon color={iconColor} size={large ? 30 : 23} strokeWidth={2.5} />
      </Pressable>
      <Text style={styles.callButtonText}>{label}</Text>
    </View>
  );
}

export function useCall() {
  const value = useContext(CallContext);
  if (!value) {
    throw new Error('useCall must be used inside CallProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  callRoot: {
    flex: 1,
    backgroundColor: '#f8fbff',
    overflow: 'hidden',
  },
  callGlowTop: {
    position: 'absolute',
    top: -140,
    left: -90,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(37, 99, 235, 0.09)',
  },
  callGlowBottom: {
    position: 'absolute',
    right: -120,
    bottom: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
  },
  remoteStage: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  remoteVideo: {
    ...StyleSheet.absoluteFill,
  },
  audioStage: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  avatarPulse: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
  },
  peerAvatar: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#38bdf8',
    borderWidth: 10,
    borderColor: '#e0f2fe',
    shadowColor: '#2563eb',
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  peerInitial: {
    color: '#ffffff',
    fontSize: 58,
    lineHeight: 70,
    fontWeight: '900',
    textAlign: 'center',
  },
  callHeader: {
    position: 'absolute',
    zIndex: 10,
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 7,
  },
  callName: {
    color: '#0f172a',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    textAlign: 'center',
  },
  callStatus: {
    color: '#64748b',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    textAlign: 'center',
  },
  localPreview: {
    position: 'absolute',
    right: 20,
    bottom: 22,
    width: 118,
    height: 168,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 22,
    backgroundColor: '#e2e8f0',
    shadowColor: '#64748b',
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  localVideo: {
    flex: 1,
  },
  callControls: {
    alignItems: 'center',
    gap: 22,
    paddingHorizontal: 22,
    paddingTop: 18,
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    shadowColor: '#94a3b8',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  incomingControlsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  callButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  callButtonWrap: {
    alignItems: 'center',
    gap: 8,
  },
  callButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  callButtonLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  callButtonDanger: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  callButtonAccept: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  callButtonMuted: {
    backgroundColor: '#e2e8f0',
    borderColor: '#cbd5e1',
  },
  callButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  callButtonText: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
