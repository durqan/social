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
import {
  mediaDevices,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView,
  type MediaStream,
} from 'react-native-webrtc';
import { WS_EVENTS } from '@social/shared';

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
import { colors } from '../theme/colors';
import { logDev, warnDev } from '../utils/logger';

type CallStatus =
  | 'idle'
  | 'incoming'
  | 'connecting'
  | 'ringing'
  | 'active'
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

const CallContext = createContext<CallContextValue | undefined>(undefined);
const disconnectedCleanupDelayMs = 10000;

function createCallId() {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
  if (status === 'ended') {
    return 'Звонок завершен';
  }
  if (status === 'error') {
    return 'Не удалось выполнить звонок';
  }
  return '';
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
  const { isForeground, resumeCount } = useAppLifecycle();
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
  const pendingIncomingCallPushRef = useRef<PendingIncomingCallPush | null>(null);
  const pendingIceRef = useRef<CallIceCandidate[]>([]);
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

  const setCallStatus = useCallback((nextStatus: CallStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
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
    setLocalStream(null);
    setRemoteStream(null);
    setMicrophoneOn(true);
    setCameraOn(true);
    setCurrentCallType('audio');
    setCallPeer(null);
    setPeerName('Пользователь');
    setError(null);
    setCallStatus('idle');
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
      setLocalStream(null);
      setRemoteStream(null);
      setMicrophoneOn(true);
      setCameraOn(true);
      setError(message ?? null);
      setCallStatus(nextStatus);
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

  const stagePendingIncomingCallPush = useCallback(
    (call: PendingIncomingCallPush) => {
      if (!user?.id || call.callerId === user.id || statusRef.current !== 'idle') {
        return;
      }

      pendingIncomingCallPushRef.current = call;
      if (call.callerId) {
        setCallPeer(call.callerId);
      }
      if (call.callerName) {
        setPeerName(call.callerName);
      }
      chatSocket.connect();
      logDev('[SocialMobile] Pending incoming call push staged', {
        callId: call.callId,
        callerId: call.callerId,
        conversationId: call.conversationId,
      });
    },
    [setCallPeer, user?.id],
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
          setCallStatus('active');
        }

        const isDisconnected =
          pc.connectionState === 'disconnected' ||
          pc.iceConnectionState === 'disconnected';

        if (isDisconnected && !disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;

            const stillDisconnected =
              pc.connectionState === 'disconnected' ||
              pc.iceConnectionState === 'disconnected';

            if (
              pcRef.current === pc &&
              callIdRef.current === callId &&
              stillDisconnected
            ) {
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
        chatSocket.connect();
        const stream = await openLocalStream(nextCallType);
        const pc = createPeerConnection(toId, callId);
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        const offer = (await pc.createOffer()) as CallSessionDescription;
        await pc.setLocalDescription(new RTCSessionDescription(offer));
        logDev('[SocialMobile] Sending call offer', {
          callId,
          toId,
          callType: nextCallType,
        });
        chatSocket.sendCallOffer(toId, offer, nextCallType, callId);
        setCallStatus('ringing');
      } catch (callError) {
        const message = callErrorMessage(callError);
        showCallError(message);
        finishCall('error', message);
      }
    },
    [
      clearEndTimer,
      createPeerConnection,
      finishCall,
      openLocalStream,
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
    const pendingOffer = pendingOfferRef.current;
    if (!pendingOffer) {
      return;
    }

    setCallStatus('connecting');
    setError(null);

    try {
      const stream = await openLocalStream(pendingOffer.callType);
      callIdRef.current = pendingOffer.callId;
      const pc = createPeerConnection(pendingOffer.fromId, pendingOffer.callId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(
        new RTCSessionDescription(pendingOffer.offer),
      );
      await flushPendingIce();

      const answer = (await pc.createAnswer()) as CallSessionDescription;
      await pc.setLocalDescription(new RTCSessionDescription(answer));
      logDev('[SocialMobile] Sending call answer', {
        callId: pendingOffer.callId,
        toId: pendingOffer.fromId,
        callType: pendingOffer.callType,
      });
      chatSocket.sendCallAnswer(
        pendingOffer.fromId,
        answer,
        pendingOffer.callId,
      );
      setCallStatus('active');
    } catch (callError) {
      try {
        chatSocket.sendCallReject(pendingOffer.fromId, pendingOffer.callId);
      } catch {
        // Ignore socket failures while leaving the failed call state.
      }
      const message = callErrorMessage(callError);
      showCallError(message);
      finishCall('error', message);
    }
  }, [
    createPeerConnection,
    finishCall,
    flushPendingIce,
    openLocalStream,
    setCallStatus,
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
        event.type !== WS_EVENTS.CALL_REJECT
      ) {
        return;
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
          if (pendingIncomingCallPushRef.current?.callId === callId) {
            pendingIncomingCallPushRef.current = null;
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
        loadPeerName(fromId, matchingPushCall?.callerName).catch(() => undefined);
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

      if (event.type === WS_EVENTS.CALL_END || statusRef.current !== 'active') {
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
  }, [resumeCount, stagePendingIncomingCallPush, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    return subscribePendingIncomingCall(stagePendingIncomingCallPush);
  }, [stagePendingIncomingCallPush, user?.id]);

  useEffect(() => {
    if (!isForeground && statusRef.current !== 'idle') {
      endCall();
    }
  }, [endCall, isForeground]);

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
  if (status === 'idle') {
    return null;
  }

  const showVideo = callType === 'video' && remoteStream;
  const showLocalPreview = callType === 'video' && localStream;
  const showActiveControls =
    status === 'connecting' || status === 'ringing' || status === 'active';

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.callRoot}>
        <View style={styles.remoteStage}>
          {showVideo ? (
            <RTCView
              streamURL={remoteStream.toURL()}
              style={styles.remoteVideo}
              objectFit="cover"
            />
          ) : (
            <View style={styles.audioStage}>
              {status === 'connecting' ? (
                <ActivityIndicator color="#ffffff" size="large" />
              ) : null}
              <Text style={styles.peerInitial}>
                {peerName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.callHeader}>
            <Text style={styles.callName} numberOfLines={1}>
              {peerName}
            </Text>
            <Text style={styles.callStatus}>
              {error ?? statusText(status, callType)}
            </Text>
          </View>

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

        <View style={styles.callControls}>
          {status === 'incoming' ? (
            <>
              <CallButton title="Отклонить" danger onPress={onReject} />
              <CallButton title="Ответить" onPress={onAccept} />
            </>
          ) : null}

          {showActiveControls ? (
            <>
              <CallButton
                title={microphoneOn ? 'Микрофон' : 'Включить микрофон'}
                muted={!microphoneOn}
                onPress={onToggleMicrophone}
              />
              {callType === 'video' ? (
                <>
                  <CallButton
                    title={cameraOn ? 'Камера' : 'Включить камеру'}
                    muted={!cameraOn}
                    onPress={onToggleCamera}
                  />
                  <CallButton title="Сменить" onPress={onSwitchCamera} />
                </>
              ) : null}
              <CallButton title="Завершить" danger onPress={onEnd} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function CallButton({
  title,
  danger,
  muted,
  onPress,
}: {
  title: string;
  danger?: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.callButton,
        danger && styles.callButtonDanger,
        muted && styles.callButtonMuted,
      ]}
      onPress={onPress}
    >
      <Text style={styles.callButtonText}>{title}</Text>
    </Pressable>
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
    backgroundColor: '#111827',
  },
  remoteStage: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteVideo: {
    ...StyleSheet.absoluteFill,
  },
  audioStage: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  peerInitial: {
    width: 112,
    height: 112,
    borderRadius: 56,
    overflow: 'hidden',
    backgroundColor: colors.accent,
    color: '#ffffff',
    fontSize: 52,
    lineHeight: 112,
    fontWeight: '800',
    textAlign: 'center',
  },
  callHeader: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 48,
    alignItems: 'center',
    gap: 6,
  },
  callName: {
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
  },
  callStatus: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  localPreview: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 112,
    height: 160,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 14,
    backgroundColor: '#020617',
  },
  localVideo: {
    flex: 1,
  },
  callControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: '#111827',
  },
  callButton: {
    minWidth: 92,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
  },
  callButtonDanger: {
    backgroundColor: colors.danger,
  },
  callButtonMuted: {
    backgroundColor: '#374151',
  },
  callButtonText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
});
