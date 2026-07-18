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
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import type { ActiveCall } from '../api/calls';
import { userApi } from '../api/users';
import {
  callLifecycle,
  registerCallShutdownHandler,
  subscribeCallLifecycle,
} from '../calls/callLifecycle';
import { liveKitCall } from '../calls/liveKitCall';
import {
  type CallStatus,
  type CallType,
  type LiveKitMediaState,
} from '../calls/types';
import { callError, describeCallError } from '../utils/callDiagnostics';
import { useAppLifecycle } from './AppLifecycleContext';
import { useAuth } from './AuthContext';
import { CallOverlay } from './CallOverlay';
import {
  isLiveServerCall,
  shouldKeepLocalServerCall,
  shouldShowIncomingServerCall,
} from './callSync';

type CallContextValue = {
  status: CallStatus;
  peerUserId: number | null;
  startAudioCall: (toId: number, peerName?: string) => Promise<void>;
  startVideoCall: (toId: number, peerName?: string) => Promise<void>;
};

const CallContext = createContext<CallContextValue | undefined>(undefined);
const callHeartbeatIntervalMs = 15_000;

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const {
    isForeground,
    networkConnected,
    resumeCount,
  } = useAppLifecycle();
  const userID = user?.id ?? null;

  const [status, setStatus] = useState<CallStatus>('idle');
  const [currentCall, setCurrentCallState] = useState<ActiveCall | null>(null);
  const [peerUserId, setPeerUserId] = useState<number | null>(null);
  const [peerName, setPeerName] = useState('Контакт');
  const [callType, setCallType] = useState<CallType>('audio');
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<LiveKitMediaState>(
    liveKitCall.getState(),
  );

  const currentCallRef = useRef<ActiveCall | null>(null);
  const statusRef = useRef<CallStatus>('idle');
  const userIDRef = useRef<number | null>(userID);
  const mediaCallIDRef = useRef<string | null>(null);
  const mediaConnectRef = useRef<{
    callID: string;
    promise: Promise<void>;
  } | null>(null);
  const mediaPermissionsRef = useRef<{
    callID: string;
    microphone: boolean;
    camera: boolean;
  } | null>(null);
  const recoveryRef = useRef<Promise<void> | null>(null);
  const finishRef = useRef<Promise<void> | null>(null);
  const shuttingDownRef = useRef(false);

  userIDRef.current = userID;

  const setCallStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const setCurrentCall = useCallback((call: ActiveCall | null) => {
    currentCallRef.current = call;
    setCurrentCallState(call);
  }, []);

  const clearLocalCall = useCallback(async (callID?: string | null) => {
    const activeCallID = currentCallRef.current?.call_id;
    if (callID && activeCallID && callID !== activeCallID) {
      return;
    }

    mediaCallIDRef.current = null;
    mediaConnectRef.current = null;
    mediaPermissionsRef.current = null;
    setCurrentCall(null);
    setPeerUserId(null);
    setPeerName('Контакт');
    setCallType('audio');
    setError(null);
    setCallStatus('idle');
    await liveKitCall.disconnect();
    if (activeCallID) {
      await callLifecycle.clearIncoming(activeCallID);
    }
  }, [setCallStatus, setCurrentCall]);

  const peerForCall = useCallback((call: ActiveCall) => {
    const localUserID = userIDRef.current;
    if (!localUserID) {
      return null;
    }
    return call.caller_id === localUserID ? call.callee_id : call.caller_id;
  }, []);

  const applyCall = useCallback(
    (call: ActiveCall, preferredPeerName?: string) => {
      const localUserID = userIDRef.current;
      const peerID = peerForCall(call);
      const embeddedPeer =
        call.caller_id === localUserID ? call.callee : call.caller;

      setCurrentCall(call);
      setPeerUserId(peerID);
      setCallType(call.call_type);
      setError(null);
      setPeerName(
        preferredPeerName?.trim() ||
          embeddedPeer?.name?.trim() ||
          'Контакт',
      );

      if (!preferredPeerName && !embeddedPeer?.name && peerID) {
        userApi
          .getUser(peerID)
          .then(peer => {
            if (currentCallRef.current?.call_id === call.call_id) {
              setPeerName(peer.name?.trim() || 'Контакт');
            }
          })
          .catch(() => undefined);
      }
    },
    [peerForCall, setCurrentCall],
  );

  const connectMedia = useCallback(
    (
      call: ActiveCall,
      grantedPermissions?: {
        microphone: boolean;
        camera: boolean;
      },
    ) => {
      const existing = mediaConnectRef.current;
      if (existing?.callID === call.call_id) {
        return existing.promise;
      }
      if (
        mediaCallIDRef.current === call.call_id &&
        liveKitCall.isConnected()
      ) {
        return Promise.resolve();
      }

      const promise = (async () => {
        if (shuttingDownRef.current || call.status !== 'accepted') {
          return;
        }
        const cachedPermissions =
          mediaPermissionsRef.current?.callID === call.call_id
            ? mediaPermissionsRef.current
            : null;
        const permissions =
          grantedPermissions ??
          cachedPermissions ??
          (await requestCallPermissions(call.call_type));
        if (!permissions.microphone) {
          throw new Error('Нужен доступ к микрофону');
        }

        setCallStatus('connecting');
        const credentials = await callLifecycle.credentials(call.call_id);
        if (
          shuttingDownRef.current ||
          currentCallRef.current?.call_id !== call.call_id
        ) {
          return;
        }

        await liveKitCall.connect({
          serverURL: credentials.server_url,
          token: credentials.token,
          video: call.call_type === 'video' && permissions.camera,
          speakerphoneOn: call.call_type === 'video',
        });
        if (
          shuttingDownRef.current ||
          currentCallRef.current?.call_id !== call.call_id
        ) {
          await liveKitCall.disconnect();
          return;
        }
        mediaCallIDRef.current = call.call_id;
        setCallStatus('active');
      })()
        .catch(connectionError => {
          if (currentCallRef.current?.call_id === call.call_id) {
            const message =
              connectionError instanceof Error
                ? connectionError.message
                : 'Не удалось подключить звонок';
            setError(message);
            setCallStatus('error');
          }
          callError('CALL_ERROR', 'LiveKit media connection failed', {
            callId: call.call_id,
            error: describeCallError(connectionError),
          });
          throw connectionError;
        })
        .finally(() => {
          if (mediaConnectRef.current?.promise === promise) {
            mediaConnectRef.current = null;
          }
        });

      mediaConnectRef.current = { callID: call.call_id, promise };
      return promise;
    },
    [setCallStatus],
  );

  const presentIncomingCall = useCallback(
    (call: ActiveCall, preferredPeerName?: string) => {
      const localUserID = userIDRef.current;
      if (!shouldShowIncomingServerCall(call, localUserID)) {
        return false;
      }
      const existing = currentCallRef.current;
      if (existing && existing.call_id !== call.call_id) {
        return false;
      }

      applyCall(call, preferredPeerName);
      setCallStatus('incoming');
      return true;
    },
    [applyCall, setCallStatus],
  );

  const restoreBusinessCall = useCallback(
    (requestedCallID?: string, preferredPeerName?: string) => {
      if (!userIDRef.current || shuttingDownRef.current) {
        return Promise.resolve();
      }
      if (recoveryRef.current) {
        return recoveryRef.current;
      }

      const promise = (async () => {
        const call = await callLifecycle.getActive(requestedCallID);
        if (!call || !isLiveServerCall(call)) {
          if (
            currentCallRef.current &&
            (!requestedCallID ||
              currentCallRef.current.call_id === requestedCallID)
          ) {
            await clearLocalCall(currentCallRef.current.call_id);
          }
          return;
        }

        if (
          currentCallRef.current &&
          !shouldKeepLocalServerCall(
            call,
            currentCallRef.current.call_id,
          )
        ) {
          await clearLocalCall(currentCallRef.current.call_id);
        }

        if (presentIncomingCall(call, preferredPeerName)) {
          return;
        }
        if (
          call.status === 'ringing' &&
          call.caller_id === userIDRef.current
        ) {
          applyCall(call, preferredPeerName);
          setCallStatus('ringing');
          return;
        }
        if (
          call.status === 'accepted' &&
          (call.caller_id === userIDRef.current ||
            call.callee_id === userIDRef.current)
        ) {
          applyCall(call, preferredPeerName);
          await connectMedia(call);
        }
      })()
        .catch(recoveryError => {
          callError('CALL_ERROR', 'call business recovery failed', {
            callId: requestedCallID,
            error: describeCallError(recoveryError),
          });
        })
        .finally(() => {
          if (recoveryRef.current === promise) {
            recoveryRef.current = null;
          }
        });

      recoveryRef.current = promise;
      return promise;
    },
    [
      applyCall,
      clearLocalCall,
      connectMedia,
      presentIncomingCall,
      setCallStatus,
    ],
  );

  const finishCurrentCall = useCallback(
    ({
      reject = false,
      notifyBackend = true,
    }: {
      reject?: boolean;
      notifyBackend?: boolean;
    } = {}) => {
      if (finishRef.current) {
        return finishRef.current;
      }
      const call = currentCallRef.current;
      if (!call) {
        return liveKitCall.disconnect();
      }

      const promise = (async () => {
        mediaCallIDRef.current = null;
        mediaConnectRef.current = null;
        mediaPermissionsRef.current = null;
        setCurrentCall(null);
        setPeerUserId(null);
        setError(null);
        setCallStatus('idle');

        const backendRequest = notifyBackend
          ? reject
            ? callLifecycle.reject(call.call_id)
            : callLifecycle.end(call.call_id)
          : Promise.resolve();

        await Promise.allSettled([
          backendRequest,
          liveKitCall.disconnect(),
          callLifecycle.markTerminal(call.call_id),
        ]);
        setPeerName('Контакт');
        setCallType('audio');
      })().finally(() => {
        finishRef.current = null;
      });

      finishRef.current = promise;
      return promise;
    },
    [setCallStatus, setCurrentCall],
  );

  const startCall = useCallback(
    async (toID: number, nextCallType: CallType, requestedName?: string) => {
      if (!userIDRef.current || toID <= 0 || toID === userIDRef.current) {
        return;
      }
      if (statusRef.current !== 'idle') {
        Alert.alert('Звонок уже идет', 'Сначала завершите текущий звонок.');
        return;
      }

      setPeerUserId(toID);
      setPeerName(requestedName?.trim() || 'Контакт');
      setCallType(nextCallType);
      setError(null);
      setCallStatus('connecting');

      try {
        const call = await callLifecycle.create(toID, nextCallType);
        if (!call) {
          throw new Error('Backend did not return the created call');
        }
        applyCall(call, requestedName);
        setCallStatus('ringing');
      } catch (startError) {
        const details = describeCallError(startError);
        const busy =
          typeof details.status === 'number' && details.status === 409;
        const message = busy
          ? 'Пользователь занят другим звонком'
          : 'Не удалось начать звонок';
        setError(message);
        setCallStatus('error');
        Alert.alert('Звонок', message);
        await clearLocalCall();
      }
    },
    [applyCall, clearLocalCall, setCallStatus],
  );

  const acceptIncomingCall = useCallback(async () => {
    const call = currentCallRef.current;
    if (
      !call ||
      statusRef.current !== 'incoming' ||
      call.callee_id !== userIDRef.current
    ) {
      return;
    }

    try {
      const permissions = await requestCallPermissions(call.call_type);
      if (!permissions.microphone) {
        Alert.alert(
          'Нет доступа',
          'Разрешите доступ к микрофону.',
        );
        return;
      }
      mediaPermissionsRef.current = {
        callID: call.call_id,
        ...permissions,
      };

      setCallStatus('connecting');
      const accepted = await callLifecycle.accept(call.call_id);
      if (!accepted || accepted.status !== 'accepted') {
        throw new Error('Call is no longer active');
      }
      applyCall(accepted);
      await callLifecycle.clearIncoming(call.call_id);
      await connectMedia(accepted, permissions);
    } catch (acceptError) {
      setError('Не удалось принять звонок');
      setCallStatus('error');
      callError('CALL_ERROR', 'accept call failed', {
        callId: call.call_id,
        error: describeCallError(acceptError),
      });
    }
  }, [applyCall, connectMedia, setCallStatus]);

  const rejectIncomingCall = useCallback(() => {
    return finishCurrentCall({ reject: true });
  }, [finishCurrentCall]);

  const endCurrentCall = useCallback(() => {
    return finishCurrentCall({
      reject: statusRef.current === 'incoming',
    });
  }, [finishCurrentCall]);

  const toggleMicrophone = useCallback(async () => {
    try {
      await liveKitCall.setMicrophoneOn(!liveKitCall.getState().microphoneOn);
    } catch (mediaError) {
      callError('CALL_ERROR', 'microphone update failed', {
        error: describeCallError(mediaError),
      });
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    try {
      const enabled = !liveKitCall.getState().cameraOn;
      if (enabled && !(await requestCameraPermission())) {
        Alert.alert('Нет доступа', 'Разрешите доступ к камере.');
        return;
      }
      await liveKitCall.setCameraOn(enabled);
    } catch (mediaError) {
      callError('CALL_ERROR', 'camera update failed', {
        error: describeCallError(mediaError),
      });
    }
  }, []);

  const toggleSpeakerphone = useCallback(async () => {
    try {
      await liveKitCall.setSpeakerphoneOn(
        !liveKitCall.getState().speakerphoneOn,
      );
    } catch (mediaError) {
      callError('CALL_ERROR', 'audio route update failed', {
        error: describeCallError(mediaError),
      });
    }
  }, []);

  const switchCamera = useCallback(async () => {
    try {
      await liveKitCall.switchCamera();
    } catch (mediaError) {
      callError('CALL_ERROR', 'camera switch failed', {
        error: describeCallError(mediaError),
      });
    }
  }, []);

  useEffect(() => liveKitCall.subscribe(setMedia), []);

  useEffect(() => {
    const call = currentCallRef.current;
    if (!call || call.status !== 'accepted') {
      return;
    }
    if (media.connectionState === 'connected') {
      setCallStatus('active');
    } else if (media.connectionState === 'reconnecting') {
      setCallStatus('reconnecting');
    } else if (media.connectionState === 'failed') {
      setError(media.error || 'Не удалось подключить звонок');
      setCallStatus('error');
    }
  }, [media.connectionState, media.error, setCallStatus]);

  useEffect(() => {
    const call = currentCall;
    if (
      !call ||
      call.status !== 'accepted' ||
      mediaCallIDRef.current !== call.call_id ||
      media.connectionState !== 'disconnected' ||
      !isForeground ||
      !networkConnected ||
      shuttingDownRef.current
    ) {
      return;
    }
    mediaCallIDRef.current = null;
    restoreBusinessCall(call.call_id).catch(() => undefined);
  }, [
    currentCall,
    isForeground,
    media.connectionState,
    networkConnected,
    restoreBusinessCall,
  ]);

  useEffect(() => {
    if (!userID) {
      shuttingDownRef.current = true;
      clearLocalCall().catch(() => undefined);
      return;
    }

    shuttingDownRef.current = false;
    const unsubscribe = subscribeCallLifecycle(signal => {
      if (signal.kind === 'incoming' || signal.kind === 'accepted') {
        restoreBusinessCall(signal.callID, signal.peerName).catch(
          () => undefined,
        );
        return;
      }
      if (
        signal.kind === 'terminal' &&
        currentCallRef.current?.call_id === signal.callID
      ) {
        callLifecycle.markTerminal(signal.callID).catch(() => undefined);
        clearLocalCall(signal.callID).catch(() => undefined);
      }
    });
    restoreBusinessCall().catch(() => undefined);
    return unsubscribe;
  }, [clearLocalCall, restoreBusinessCall, userID]);

  useEffect(() => {
    if (
      userID &&
      isForeground &&
      networkConnected &&
      !shuttingDownRef.current
    ) {
      restoreBusinessCall(currentCallRef.current?.call_id).catch(
        () => undefined,
      );
    }
  }, [
    isForeground,
    networkConnected,
    restoreBusinessCall,
    resumeCount,
    userID,
  ]);

  useEffect(() => {
    const call = currentCall;
    const peerID = call ? peerForCall(call) : null;
    if (!call || !peerID || call.status !== 'accepted') {
      return;
    }

    callLifecycle.heartbeat(peerID, call.call_id);
    const timer = setInterval(() => {
      if (
        currentCallRef.current?.call_id === call.call_id &&
        !shuttingDownRef.current
      ) {
        callLifecycle.heartbeat(peerID, call.call_id);
      }
    }, callHeartbeatIntervalMs);
    return () => clearInterval(timer);
  }, [currentCall, peerForCall]);

  useEffect(() => {
    return registerCallShutdownHandler(async () => {
      shuttingDownRef.current = true;
      const call = currentCallRef.current;
      await finishCurrentCall({
        reject:
          Boolean(call) &&
          call?.status === 'ringing' &&
          call.callee_id === userIDRef.current,
      });
    });
  }, [finishCurrentCall]);

  useEffect(
    () => () => {
      shuttingDownRef.current = true;
      liveKitCall.disconnect().catch(() => undefined);
    },
    [],
  );

  const value = useMemo(
    () => ({
      status,
      peerUserId,
      startAudioCall: (toID: number, name?: string) =>
        startCall(toID, 'audio', name),
      startVideoCall: (toID: number, name?: string) =>
        startCall(toID, 'video', name),
    }),
    [peerUserId, startCall, status],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay
        status={status}
        callType={callType}
        peerName={peerName}
        acceptedAt={currentCall?.accepted_at}
        localVideoTrack={media.localVideoTrack}
        remoteVideoTrack={media.remoteVideoTrack}
        microphoneOn={media.microphoneOn}
        cameraOn={media.cameraOn}
        speakerphoneOn={media.speakerphoneOn}
        frontCamera={media.frontCamera}
        error={error ?? media.error}
        onAccept={() => {
          acceptIncomingCall().catch(() => undefined);
        }}
        onReject={() => {
          rejectIncomingCall().catch(() => undefined);
        }}
        onEnd={() => {
          endCurrentCall().catch(() => undefined);
        }}
        onToggleMicrophone={() => {
          toggleMicrophone().catch(() => undefined);
        }}
        onToggleCamera={() => {
          toggleCamera().catch(() => undefined);
        }}
        onToggleSpeakerphone={() => {
          toggleSpeakerphone().catch(() => undefined);
        }}
        onSwitchCamera={() => {
          switchCamera().catch(() => undefined);
        }}
      />
    </CallContext.Provider>
  );
}

async function requestCallPermissions(callType: CallType) {
  if (Platform.OS !== 'android') {
    return { microphone: true, camera: true };
  }
  const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (callType === 'video') {
    permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  }
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return {
    microphone:
      results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED,
    camera:
      callType !== 'video' ||
      results[PermissionsAndroid.PERMISSIONS.CAMERA] ===
        PermissionsAndroid.RESULTS.GRANTED,
  };
}

async function requestCameraPermission() {
  if (Platform.OS !== 'android') {
    return true;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function useCall() {
  const value = useContext(CallContext);
  if (!value) {
    throw new Error('useCall must be used inside CallProvider');
  }
  return value;
}
