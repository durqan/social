import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from "@/app/providers/AuthContext.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";

import { callService, type ActiveCall } from "@/features/call/api/callService.js";
import { CallOverlay } from "@/features/call/components/CallOverlay.js";
import { userService } from "@/shared/api/userService.js";
import { getCallErrorMessage } from "@/features/call/lib/callConfig.js";
import {
    addIceCandidates,
    addStreamTracks,
    applyVideoSenderQuality,
    attachMediaStream,
    closePeerConnection,
    countVideoInputDevices,
    createCallPeerConnection,
    detachMediaElement,
    openLocalCallStream,
    openReplacementVideoTrack,
    replaceVideoSenderTrack,
    stopMediaStream,
    type CameraFacingMode,
} from "@/features/call/lib/callMedia.js";
import { useRefState } from "@/shared/hooks/useRefState.js";

import type { CallStatus, CallType } from "@/features/call/types.js";
import type { WsEvent } from "@/shared/types/ws.js";
import { WS_EVENTS } from '@social/shared';

type AudioCallContextValue = {
    status: CallStatus;
    callType: CallType;
    peerUserId: number | null;
    startCall: (toId: number, peerName?: string) => Promise<void>;
    startVideoCall: (toId: number, peerName?: string) => Promise<void>;
};

const AudioCallContext = createContext<AudioCallContextValue | null>(null);
const CallChatPanel = lazy(async () => {
    const module = await import("@/features/call/components/CallChatPanel.js");
    return { default: module.CallChatPanel };
});

function createCallId() {
    return globalThis.crypto?.randomUUID?.() ??
        `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCallId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

const terminalCallCleanupDelayMs = 1800;
const callHeartbeatIntervalMs = 15000;

function isTerminalCallStatus(status: CallStatus) {
    return status === 'ended' || status === 'error';
}

function terminalCallMessage(type: string) {
    switch (type) {
        case WS_EVENTS.CALL_REJECT:
            return 'Звонок отклонен.';
        case WS_EVENTS.CALL_TIMEOUT:
            return 'Звонок не был принят.';
        case WS_EVENTS.CALL_BUSY:
            return 'Пользователь занят.';
        case WS_EVENTS.CALL_REPLACED:
            return 'Звонок заменен новым вызовом.';
        default:
            return 'Звонок завершен.';
    }
}

export const AudioCallProvider = ({ children }: { children: ReactNode }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const wsService = useWebSocket();
    const { currentUser } = useAuth();
    const currentUserId = currentUser?.id;

    const [status, statusRef, setCallStatus] = useRefState<CallStatus>('idle');
    const [callType, callTypeRef, setCurrentCallType] = useRefState<CallType>('audio');
    const [peerUserId, peerUserIdRef, setCallPeer] = useRefState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMicrophoneOn, isMicrophoneOnRef, setIsMicrophoneOn] = useRefState(true);
    const [isCameraOn, isCameraOnRef, setIsCameraOn] = useRefState(true);
    const [, cameraFacingModeRef, setCameraFacingMode] = useRefState<CameraFacingMode>('user');
    const [hasLocalVideo, setHasLocalVideo] = useState(false);
    const [canSwitchCamera, setCanSwitchCamera] = useState(false);
    const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
    const [isCallChatOpen, isCallChatOpenRef, setIsCallChatOpen] = useRefState(false);
    const [callChatUnread, callChatUnreadRef, setCallChatUnread] = useRefState(0);

    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const callIdRef = useRef<string | null>(null);
    const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
    const hydratingCallIdsRef = useRef(new Set<string>());
    const hydratingActiveRef = useRef(false);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
    const disconnectTimeoutRef = useRef<number | null>(null);
    const terminalCleanupTimerRef = useRef<number | null>(null);

    const stopLocalStream = useCallback(() => {
        stopMediaStream(localStreamRef.current);
        localStreamRef.current = null;
    }, []);

    const refreshVideoInputSupport = useCallback(async () => {
        try {
            setCanSwitchCamera(await countVideoInputDevices() > 1);
        } catch {
            setCanSwitchCamera(false);
        }
    }, []);

    const cleanupMediaSession = useCallback(() => {
        if (disconnectTimeoutRef.current) {
            window.clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
        }

        closePeerConnection(peerConnectionRef.current);
        peerConnectionRef.current = null;
        incomingOfferRef.current = null;
        pendingIceRef.current = [];
        stopMediaStream(remoteStreamRef.current);
        remoteStreamRef.current = null;
        stopLocalStream();
        setHasLocalVideo(false);
        setCanSwitchCamera(false);
        setIsSwitchingCamera(false);

        detachMediaElement(remoteAudioRef.current);
        detachMediaElement(localVideoRef.current);
        detachMediaElement(remoteVideoRef.current);
    }, [stopLocalStream]);

    const cleanupCall = useCallback(() => {
        const callId = callIdRef.current;

        if (terminalCleanupTimerRef.current) {
            window.clearTimeout(terminalCleanupTimerRef.current);
            terminalCleanupTimerRef.current = null;
        }

        if (callId) {
            wsService.discardPendingCallEvents(callId);
        }

        cleanupMediaSession();
        callIdRef.current = null;
        setCallPeer(null);
        setPeerName('Пользователь');
        setCurrentCallType('audio');
        setIsExpanded(false);
        setIsMicrophoneOn(true);
        setIsCameraOn(true);
        setCameraFacingMode('user');
        setIsCallChatOpen(false);
        setCallChatUnread(0);
        setError(null);
        setCallStatus('idle');
    }, [
        cleanupMediaSession,
        setCallChatUnread,
        setCallPeer,
        setCallStatus,
        setCameraFacingMode,
        setCurrentCallType,
        setIsCallChatOpen,
        setIsCameraOn,
        setIsMicrophoneOn,
        wsService,
    ]);

    const finishCall = useCallback((message: string, nextStatus: CallStatus = 'ended') => {
        const callId = callIdRef.current;

        if (terminalCleanupTimerRef.current) {
            window.clearTimeout(terminalCleanupTimerRef.current);
            terminalCleanupTimerRef.current = null;
        }

        if (callId) {
            wsService.discardPendingCallEvents(callId);
        }

        cleanupMediaSession();
        setError(message);
        setCallStatus(nextStatus);
        terminalCleanupTimerRef.current = window.setTimeout(() => {
            terminalCleanupTimerRef.current = null;
            cleanupCall();
        }, terminalCallCleanupDelayMs);
    }, [cleanupCall, cleanupMediaSession, setCallStatus, wsService]);

    const sendCurrentCallEnd = useCallback(() => {
        const toId = peerUserIdRef.current;
        const callId = callIdRef.current;

        if (toId && callId && !isTerminalCallStatus(statusRef.current)) {
            wsService.sendCallEnd(toId, callId);
            void callService.endCall(callId).catch(error => {
                console.error('Failed to end interrupted call:', error);
            });
        }
    }, [peerUserIdRef, statusRef, wsService]);

    const getLocalStream = useCallback(async (nextCallType: CallType) => {
        if (!localStreamRef.current) {
            const result = await openLocalCallStream(nextCallType);
            const videoTrack = result.stream.getVideoTracks()[0];
            const detectedFacingMode = videoTrack?.getSettings().facingMode;

            localStreamRef.current = result.stream;
            setHasLocalVideo(Boolean(videoTrack));
            setIsMicrophoneOn(true);
            setIsCameraOn(Boolean(videoTrack));
            setCameraFacingMode(detectedFacingMode === 'environment' ? 'environment' : 'user');
            void refreshVideoInputSupport();

            if (result.warning) {
                setError(result.warning);
            }

            if (result.callType !== nextCallType) {
                setCurrentCallType(result.callType);
            }
        }

        return localStreamRef.current;
    }, [
        refreshVideoInputSupport,
        setCameraFacingMode,
        setCurrentCallType,
        setIsCameraOn,
        setIsMicrophoneOn,
    ]);

    const flushPendingIce = useCallback(async () => {
        const pc = peerConnectionRef.current;

        if (!pc?.remoteDescription) {
            return;
        }

        const pendingCandidates = pendingIceRef.current;
        pendingIceRef.current = [];

        await addIceCandidates(pc, pendingCandidates, 'Failed to add pending ICE candidate:');
    }, []);

    const createPeerConnection = useCallback((toId: number, callId: string) => {
        const pc = createCallPeerConnection({
            toId,
            callId,
            wsService,
            onRemoteStream: remoteStream => {
                remoteStreamRef.current = remoteStream;
                attachMediaStream(remoteAudioRef.current, remoteStream);
                attachMediaStream(remoteVideoRef.current, remoteStream);
            },
            onConnectionStateChange: state => {
                if (state === 'connected') {
                    if (disconnectTimeoutRef.current) {
                        window.clearTimeout(disconnectTimeoutRef.current);
                        disconnectTimeoutRef.current = null;
                    }

                    setCallStatus('active');
                }

                if (state === 'failed') {
                    sendCurrentCallEnd();
                    cleanupCall();
                    return;
                }

                if (state === 'closed') {
                    cleanupCall();
                    return;
                }

                if (state !== 'disconnected' || disconnectTimeoutRef.current) {
                    return;
                }

                disconnectTimeoutRef.current = window.setTimeout(() => {
                    disconnectTimeoutRef.current = null;

                    if (peerConnectionRef.current?.connectionState === 'disconnected') {
                        sendCurrentCallEnd();
                        cleanupCall();
                    }
                }, 10000);
            },
        });

        peerConnectionRef.current = pc;
        return pc;
    }, [cleanupCall, sendCurrentCallEnd, setCallStatus, wsService]);

    const loadPeerName = useCallback(async (userId: number, fallback?: string) => {
        if (fallback) {
            setPeerName(fallback);
            return;
        }

        try {
            const user = await userService.getUser(userId);
            setPeerName(user.name || 'Пользователь');
        } catch {
            setPeerName('Пользователь');
        }
    }, []);

    const showHydratedIncomingCall = useCallback(async (call: ActiveCall) => {
        if (!currentUserId || call.status !== 'ringing' || call.callee_id !== currentUserId) {
            return;
        }

        if (call.caller_id === currentUserId) {
            return;
        }

        if (statusRef.current !== 'idle') {
            return;
        }

        setError(null);
        callIdRef.current = call.call_id;
        incomingOfferRef.current = call.offer ?? null;
        pendingIceRef.current = call.ice_candidates ?? [];
        setCallPeer(call.caller_id);
        setCurrentCallType(call.call_type === 'video' ? 'video' : 'audio');
        setCallStatus('incoming');
        await loadPeerName(call.caller_id, call.caller?.name);
    }, [
        currentUserId,
        loadPeerName,
        setCallPeer,
        setCallStatus,
        setCurrentCallType,
        statusRef,
    ]);

    const hydrateIncomingCall = useCallback(async (callId?: string | null) => {
        if (!currentUserId) {
            return;
        }

        const normalizedCallId = callId?.trim();
        if (normalizedCallId) {
            if (
                callIdRef.current === normalizedCallId &&
                statusRef.current === 'incoming' &&
                incomingOfferRef.current
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
                ? await callService.getActiveCall(normalizedCallId)
                : await callService.getActiveCall();
            if (call) {
                await showHydratedIncomingCall(call);
            }
        } catch (error) {
            console.error('Failed to hydrate incoming call:', error);
        } finally {
            if (normalizedCallId) {
                hydratingCallIdsRef.current.delete(normalizedCallId);
            } else {
                hydratingActiveRef.current = false;
            }
        }
    }, [currentUserId, showHydratedIncomingCall, statusRef]);

    const startCallWithType = useCallback(async (toId: number, name: string | undefined, nextCallType: CallType) => {
        if (!currentUser || statusRef.current !== 'idle') {
            return;
        }

        setError(null);
        const callId = createCallId();
        callIdRef.current = callId;
        setCallPeer(toId);
        setPeerName(name || 'Пользователь');
        setCurrentCallType(nextCallType);
        setCallStatus('calling');

        try {
            const localStream = await getLocalStream(nextCallType);
            const pc = createPeerConnection(toId, callId);

            addStreamTracks(pc, localStream);
            await applyVideoSenderQuality(pc);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsService.sendCallOffer(toId, offer, callTypeRef.current, callId);
        } catch (e) {
            console.error('Failed to start call:', e);
            setError(getCallErrorMessage(e, 'Не удалось начать звонок'));
            cleanupCall();
        }
    }, [
        callTypeRef,
        cleanupCall,
        createPeerConnection,
        currentUser,
        getLocalStream,
        setCallPeer,
        setCallStatus,
        setCurrentCallType,
        statusRef,
        wsService,
    ]);

    const startCall = useCallback((toId: number, name?: string) => (
        startCallWithType(toId, name, 'audio')
    ), [startCallWithType]);

    const startVideoCall = useCallback((toId: number, name?: string) => (
        startCallWithType(toId, name, 'video')
    ), [startCallWithType]);

    const openPeerProfile = useCallback((userId: number) => {
        navigate(`/users/${userId}`);
    }, [navigate]);

    const toggleMicrophone = useCallback(() => {
        const nextEnabled = !isMicrophoneOnRef.current;

        localStreamRef.current?.getAudioTracks().forEach(track => {
            track.enabled = nextEnabled;
        });
        setIsMicrophoneOn(nextEnabled);
    }, [isMicrophoneOnRef, setIsMicrophoneOn]);

    const toggleCamera = useCallback(() => {
        const videoTracks = localStreamRef.current?.getVideoTracks() || [];

        if (!videoTracks.length) {
            return;
        }

        const nextEnabled = !isCameraOnRef.current;
        videoTracks.forEach(track => {
            track.enabled = nextEnabled;
        });
        setIsCameraOn(nextEnabled);
    }, [isCameraOnRef, setIsCameraOn]);

    const switchCamera = useCallback(async () => {
        const stream = localStreamRef.current;

        if (!stream || !hasLocalVideo || !canSwitchCamera || isSwitchingCamera) {
            return;
        }

        const nextFacingMode = cameraFacingModeRef.current === 'user' ? 'environment' : 'user';
        setIsSwitchingCamera(true);

        try {
            const newTrack = await openReplacementVideoTrack(stream, nextFacingMode);
            newTrack.enabled = isCameraOnRef.current;
            await replaceVideoSenderTrack(peerConnectionRef.current, stream, newTrack);

            if (peerConnectionRef.current) {
                await applyVideoSenderQuality(peerConnectionRef.current);
            }

            attachMediaStream(localVideoRef.current, stream);

            const detectedFacingMode = newTrack.getSettings().facingMode;
            setCameraFacingMode(detectedFacingMode === 'environment' ? 'environment' : nextFacingMode);
            setHasLocalVideo(true);
            void refreshVideoInputSupport();
        } catch (e) {
            console.error('Failed to switch camera:', e);
            setError(getCallErrorMessage(e, 'Не удалось переключить камеру'));
        } finally {
            setIsSwitchingCamera(false);
        }
    }, [
        cameraFacingModeRef,
        canSwitchCamera,
        hasLocalVideo,
        isCameraOnRef,
        isSwitchingCamera,
        refreshVideoInputSupport,
        setCameraFacingMode,
    ]);

    const toggleCallChat = useCallback(() => {
        if (!peerUserIdRef.current) {
            return;
        }

        const nextOpen = !isCallChatOpenRef.current;
        setIsCallChatOpen(nextOpen);

        if (nextOpen) {
            setCallChatUnread(0);
        }
    }, [isCallChatOpenRef, peerUserIdRef, setCallChatUnread, setIsCallChatOpen]);

    const closeCallChat = useCallback(() => {
        setIsCallChatOpen(false);
    }, [setIsCallChatOpen]);

    const markCallChatSeen = useCallback(() => {
        setCallChatUnread(0);
    }, [setCallChatUnread]);

    const acceptCall = useCallback(async () => {
        const fromId = peerUserIdRef.current;
        const offer = incomingOfferRef.current;
        const nextCallType = callTypeRef.current;
        const callId = callIdRef.current;

        if (!fromId || !callId) {
            return;
        }

        if (!offer) {
            setError('Восстанавливаем соединение звонка...');
            void hydrateIncomingCall(callId);
            wsService.connect();
            return;
        }

        setError(null);

        try {
            const localStream = await getLocalStream(nextCallType);
            const pc = createPeerConnection(fromId, callId);

            addStreamTracks(pc, localStream);
            await applyVideoSenderQuality(pc);

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            await flushPendingIce();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            wsService.sendCallAnswer(fromId, answer, callId);
            setCallStatus('active');
        } catch (e) {
            console.error('Failed to accept call:', e);
            setError(getCallErrorMessage(e, 'Не удалось принять звонок'));
            wsService.sendCallReject(fromId, callId);
            cleanupCall();
        }
    }, [
        callTypeRef,
        cleanupCall,
        createPeerConnection,
        flushPendingIce,
        getLocalStream,
        hydrateIncomingCall,
        peerUserIdRef,
        setCallStatus,
        wsService,
    ]);

    const rejectCall = useCallback(() => {
        const fromId = peerUserIdRef.current;
        const callId = callIdRef.current;

        if (fromId && callId) {
            wsService.sendCallReject(fromId, callId);
        }

        cleanupCall();
    }, [cleanupCall, peerUserIdRef, wsService]);

    const endCall = useCallback(() => {
        const toId = peerUserIdRef.current;
        const callId = callIdRef.current;

        if (toId && callId) {
            wsService.sendCallEnd(toId, callId);
        }

        cleanupCall();
    }, [cleanupCall, peerUserIdRef, wsService]);

    useEffect(() => {
        const handleMessage = async (event: WsEvent) => {
            switch (event.type) {
                case WS_EVENTS.CALL_OFFER: {
                    const {
                        from_id: fromId,
                        call_id: callId,
                        offer,
                        call_type: incomingCallType,
                    } = event.payload;

                    if (fromId === currentUser?.id || !isCallId(callId)) {
                        return;
                    }

                    if (statusRef.current !== 'idle') {
                        if (statusRef.current === 'incoming' && callIdRef.current === callId) {
                            incomingOfferRef.current = offer;
                            setCallPeer(fromId);
                            setCurrentCallType(incomingCallType === 'video' ? 'video' : 'audio');
                            await loadPeerName(fromId);
                            return;
                        }

                        wsService.sendCallReject(fromId, callId);
                        return;
                    }

                    setError(null);
                    callIdRef.current = callId;
                    setCallPeer(fromId);
                    setCurrentCallType(incomingCallType === 'video' ? 'video' : 'audio');
                    incomingOfferRef.current = offer;
                    setCallStatus('incoming');
                    await loadPeerName(fromId);

                    return;
                }

                case WS_EVENTS.CALL_ANSWER: {
                    const { from_id: fromId, call_id: callId, answer } = event.payload;

                    if (!isCallId(callId) || callId !== callIdRef.current) {
                        return;
                    }

                    if (fromId === currentUser?.id) {
                        if (!peerConnectionRef.current || statusRef.current === 'incoming') {
                            cleanupCall();
                        }
                        return;
                    }

                    if (fromId !== peerUserIdRef.current || !peerConnectionRef.current) {
                        return;
                    }

                    await peerConnectionRef.current.setRemoteDescription(
                        new RTCSessionDescription(answer)
                    );
                    await flushPendingIce();
                    setCallStatus('active');

                    return;
                }

                case WS_EVENTS.CALL_ICE: {
                    const { from_id: fromId, call_id: callId, candidate } = event.payload;

                    if (
                        fromId === currentUser?.id ||
                        fromId !== peerUserIdRef.current ||
                        !isCallId(callId) ||
                        callId !== callIdRef.current
                    ) {
                        return;
                    }

                    const pc = peerConnectionRef.current;

                    if (!pc?.remoteDescription) {
                        pendingIceRef.current.push(candidate);
                        return;
                    }

                    await addIceCandidates(pc, [candidate], 'Failed to add ICE candidate:');

                    return;
                }

                case WS_EVENTS.CALL_END:
                case WS_EVENTS.CALL_REJECT: {
                    const { from_id: fromId, call_id: callId } = event.payload;

                    if (!isCallId(callId) || callId !== callIdRef.current) {
                        return;
                    }

                    if (fromId === currentUser?.id) {
                        cleanupCall();
                        return;
                    }

                    if (fromId === peerUserIdRef.current) {
                        if (event.type === WS_EVENTS.CALL_END || statusRef.current !== 'active') {
                            finishCall(terminalCallMessage(event.type));
                        }
                    }

                    return;
                }

                case WS_EVENTS.CALL_TIMEOUT:
                case WS_EVENTS.CALL_BUSY:
                case WS_EVENTS.CALL_REPLACED: {
                    const { call_id: callId } = event.payload;

                    if (!isCallId(callId) || callId !== callIdRef.current) {
                        return;
                    }

                    finishCall(terminalCallMessage(event.type));
                    return;
                }

                case WS_EVENTS.MESSAGE_NEW: {
                    const message = event.payload;

                    if (
                        statusRef.current !== 'idle' &&
                        !isTerminalCallStatus(statusRef.current) &&
                        !isCallChatOpenRef.current &&
                        message.from_id === peerUserIdRef.current &&
                        message.to_id === currentUser?.id
                    ) {
                        setCallChatUnread(callChatUnreadRef.current + 1);
                    }

                    return;
                }

                default:
                    return;
            }
        };

        wsService.onMessage(handleMessage);

        return () => {
            wsService.removeMessageHandler(handleMessage);
        };
    }, [
        cleanupCall,
        callChatUnreadRef,
        currentUser?.id,
        finishCall,
        flushPendingIce,
        isCallChatOpenRef,
        loadPeerName,
        peerUserIdRef,
        setCallChatUnread,
        setCallPeer,
        setCallStatus,
        setCurrentCallType,
        statusRef,
        wsService,
    ]);

    useEffect(() => {
        if (!currentUserId) {
            return;
        }

        void hydrateIncomingCall();
    }, [currentUserId, hydrateIncomingCall]);

    useEffect(() => {
        if (!currentUserId) {
            return;
        }

        const params = new URLSearchParams(location.search);
        const incomingCall = params.get('incomingCall') === '1' || params.has('incomingCallId');
        const callId = params.get('callId') || params.get('incomingCallId');
        if (incomingCall || callId) {
            void hydrateIncomingCall(callId);
        }
    }, [currentUserId, hydrateIncomingCall, location.search]);

    useEffect(() => {
        if (!currentUserId) {
            return undefined;
        }

        const hydrateActiveCall = () => {
            void hydrateIncomingCall();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                hydrateActiveCall();
            }
        };

        const handleServiceWorkerMessage = (event: MessageEvent) => {
            const data = event.data as {
                type?: string;
                kind?: string;
                callId?: string;
                conversationId?: number;
                url?: string;
            } | undefined;

            if (data?.type !== 'notification-click' || data.kind !== 'incoming_call') {
                return;
            }

            if (data.url) {
                try {
                    const target = new URL(data.url);
                    if (target.origin === window.location.origin) {
                        navigate(`${target.pathname}${target.search}${target.hash}`);
                    }
                } catch {
                    // Ignore malformed notification URLs; hydration below is enough.
                }
            } else if (data.conversationId) {
                navigate(`/users/${currentUserId}/chat/${data.conversationId}`);
            }

            void hydrateIncomingCall(data.callId);
        };

        window.addEventListener('focus', hydrateActiveCall);
        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('websocket:open', hydrateActiveCall);
        navigator.serviceWorker?.addEventListener?.('message', handleServiceWorkerMessage);

        return () => {
            window.removeEventListener('focus', hydrateActiveCall);
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('websocket:open', hydrateActiveCall);
            navigator.serviceWorker?.removeEventListener?.('message', handleServiceWorkerMessage);
        };
    }, [currentUserId, hydrateIncomingCall, navigate]);

    useEffect(() => {
        if (status !== 'active') {
            return undefined;
        }

        const sendHeartbeat = () => {
            const toId = peerUserIdRef.current;
            const callId = callIdRef.current;
            if (toId && callId) {
                wsService.sendCallHeartbeat(toId, callId);
            }
        };

        sendHeartbeat();
        const heartbeatTimer = window.setInterval(sendHeartbeat, callHeartbeatIntervalMs);
        return () => window.clearInterval(heartbeatTimer);
    }, [peerUserIdRef, status, wsService]);

    useEffect(() => {
        if (!currentUser && statusRef.current !== 'idle') {
            const toId = peerUserIdRef.current;
            const callId = callIdRef.current;
            if (toId && callId && !isTerminalCallStatus(statusRef.current)) {
                wsService.sendCallEnd(toId, callId);
            }

            cleanupCall();
        }
    }, [cleanupCall, currentUser, peerUserIdRef, statusRef, wsService]);

    useEffect(() => {
        const refreshDevices = () => {
            void refreshVideoInputSupport();
        };

        navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

        return () => {
            navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
        };
    }, [refreshVideoInputSupport]);

    useEffect(() => {
        if (callType !== 'video') {
            return;
        }

        attachMediaStream(localVideoRef.current, localStreamRef.current);
        attachMediaStream(remoteVideoRef.current, remoteStreamRef.current);
    }, [callType, status]);

    useEffect(() => {
        const endCurrentCall = () => {
            if (statusRef.current === 'idle') {
                return;
            }

            const toId = peerUserIdRef.current;
            const callId = callIdRef.current;
            if (toId && callId && !isTerminalCallStatus(statusRef.current)) {
                wsService.sendCallEnd(toId, callId);
            }

            cleanupCall();
        };

        window.addEventListener('pagehide', endCurrentCall);
        window.addEventListener('beforeunload', endCurrentCall);

        return () => {
            window.removeEventListener('pagehide', endCurrentCall);
            window.removeEventListener('beforeunload', endCurrentCall);
            endCurrentCall();
        };
    }, [cleanupCall, peerUserIdRef, statusRef, wsService]);

    const value = useMemo(() => ({
        status,
        callType,
        peerUserId,
        startCall,
        startVideoCall,
    }), [callType, peerUserId, startCall, startVideoCall, status]);

    return (
        <AudioCallContext.Provider value={value}>
            {children}

            <audio ref={remoteAudioRef} autoPlay />

            <CallOverlay
                status={status}
                callType={callType}
                peerName={peerName}
                error={error}
                isExpanded={isExpanded}
                peerUserId={peerUserId}
                isMicrophoneOn={isMicrophoneOn}
                isCameraOn={isCameraOn}
                hasLocalVideo={hasLocalVideo}
                canSwitchCamera={canSwitchCamera}
                isSwitchingCamera={isSwitchingCamera}
                isChatOpen={isCallChatOpen}
                unreadChatCount={callChatUnread}
                localVideoRef={localVideoRef}
                remoteVideoRef={remoteVideoRef}
                onToggleExpanded={() => setIsExpanded(prev => !prev)}
                onToggleMicrophone={toggleMicrophone}
                onToggleCamera={toggleCamera}
                onSwitchCamera={switchCamera}
                onToggleChat={toggleCallChat}
                onAccept={acceptCall}
                onReject={rejectCall}
                onEnd={endCall}
                onOpenPeerProfile={openPeerProfile}
            />

            {isCallChatOpen && peerUserId && currentUser && (
                <Suspense
                    fallback={(
                        <div
                            className="fixed inset-0 z-[60] bg-black/45 sm:bg-black/30"
                            role="status"
                            aria-label="Загрузка чата звонка"
                        >
                            <section className="absolute inset-x-0 bottom-0 flex max-h-[78vh] min-h-[420px] flex-col overflow-hidden rounded-t-2xl bg-[var(--app-chat-bg)] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[390px] sm:rounded-none">
                                <div className="flex flex-1 items-center justify-center text-[var(--app-text-secondary)]">
                                    <span className="chat-composer-spinner" aria-hidden="true" />
                                </div>
                            </section>
                        </div>
                    )}
                >
                    <CallChatPanel
                        peerUserId={peerUserId}
                        peerName={peerName}
                        currentUser={currentUser}
                        onClose={closeCallChat}
                        onSeen={markCallChatSeen}
                    />
                </Suspense>
            )}
        </AudioCallContext.Provider>
    );
};

export const useAudioCall = () => {
    const context = useContext(AudioCallContext);

    if (!context) {
        throw new Error('useAudioCall must be used within AudioCallProvider');
    }

    return context;
};
