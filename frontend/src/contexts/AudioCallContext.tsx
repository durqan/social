import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './AuthContext.js';
import { useWebSocket } from './WebSocketContext.js';

import { CallOverlay } from '../components/call/CallOverlay.js';
import { userService } from '../services/userService.js';
import { getCallErrorMessage } from '../services/callConfig.js';
import {
    addIceCandidates,
    addStreamTracks,
    applyVideoSenderQuality,
    attachMediaStream,
    createCallPeerConnection,
    detachMediaElement,
    openLocalCallStream,
    stopMediaStream,
} from '../utils/callMedia.js';
import { useRefState } from '../hooks/useRefState.js';

import type { CallStatus, CallType } from '../types/call.js';
import type { WsEvent } from '../types/ws/events.js';

type AudioCallContextValue = {
    status: CallStatus;
    callType: CallType;
    peerUserId: number | null;
    startCall: (toId: number, peerName?: string) => Promise<void>;
    startVideoCall: (toId: number, peerName?: string) => Promise<void>;
};

const AudioCallContext = createContext<AudioCallContextValue | null>(null);

export const AudioCallProvider = ({ children }: { children: ReactNode }) => {
    const wsService = useWebSocket();
    const { currentUser } = useAuth();

    const [status, statusRef, setCallStatus] = useRefState<CallStatus>('idle');
    const [callType, callTypeRef, setCurrentCallType] = useRefState<CallType>('audio');
    const [peerUserId, peerUserIdRef, setCallPeer] = useRefState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
    const disconnectTimeoutRef = useRef<number | null>(null);

    const stopLocalStream = useCallback(() => {
        stopMediaStream(localStreamRef.current);
        localStreamRef.current = null;
    }, []);

    const cleanupMediaSession = useCallback(() => {
        if (disconnectTimeoutRef.current) {
            window.clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
        }

        peerConnectionRef.current?.close();
        peerConnectionRef.current = null;
        incomingOfferRef.current = null;
        pendingIceRef.current = [];
        remoteStreamRef.current = null;
        stopLocalStream();

        detachMediaElement(remoteAudioRef.current);
        detachMediaElement(localVideoRef.current);
        detachMediaElement(remoteVideoRef.current);
    }, [stopLocalStream]);

    const cleanupCall = useCallback(() => {
        cleanupMediaSession();
        setCallPeer(null);
        setPeerName('Пользователь');
        setCurrentCallType('audio');
        setIsExpanded(false);
        setCallStatus('idle');
    }, [cleanupMediaSession, setCallPeer, setCallStatus, setCurrentCallType]);

    const getLocalStream = useCallback(async (nextCallType: CallType) => {
        if (!localStreamRef.current) {
            const result = await openLocalCallStream(nextCallType);

            localStreamRef.current = result.stream;

            if (result.warning) {
                setError(result.warning);
            }

            if (result.callType !== nextCallType) {
                setCurrentCallType(result.callType);
            }
        }

        return localStreamRef.current;
    }, [setCurrentCallType]);

    const flushPendingIce = useCallback(async () => {
        const pc = peerConnectionRef.current;

        if (!pc?.remoteDescription) {
            return;
        }

        const pendingCandidates = pendingIceRef.current;
        pendingIceRef.current = [];

        await addIceCandidates(pc, pendingCandidates, 'Failed to add pending ICE candidate:');
    }, []);

    const createPeerConnection = useCallback((toId: number) => {
        const pc = createCallPeerConnection({
            toId,
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

                if (state === 'failed' || state === 'closed') {
                    cleanupCall();
                }

                if (state !== 'disconnected' || disconnectTimeoutRef.current) {
                    return;
                }

                disconnectTimeoutRef.current = window.setTimeout(() => {
                    disconnectTimeoutRef.current = null;

                    if (peerConnectionRef.current?.connectionState === 'disconnected') {
                        cleanupCall();
                    }
                }, 10000);
            },
        });

        peerConnectionRef.current = pc;
        return pc;
    }, [cleanupCall, setCallStatus, wsService]);

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

    const startCallWithType = useCallback(async (toId: number, name: string | undefined, nextCallType: CallType) => {
        if (!currentUser || statusRef.current !== 'idle') {
            return;
        }

        setError(null);
        setCallPeer(toId);
        setPeerName(name || 'Пользователь');
        setCurrentCallType(nextCallType);
        setCallStatus('calling');

        try {
            const localStream = await getLocalStream(nextCallType);
            const pc = createPeerConnection(toId);

            addStreamTracks(pc, localStream);
            await applyVideoSenderQuality(pc);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsService.sendCallOffer(toId, offer, callTypeRef.current);
        } catch (e) {
            console.error('Failed to start call:', e);
            setError(getCallErrorMessage(e, 'Не удалось начать звонок'));
            cleanupCall();
        }
    }, [
        cleanupCall,
        createPeerConnection,
        currentUser,
        getLocalStream,
        setCallPeer,
        setCallStatus,
        setCurrentCallType,
        wsService,
    ]);

    const startCall = useCallback((toId: number, name?: string) => (
        startCallWithType(toId, name, 'audio')
    ), [startCallWithType]);

    const startVideoCall = useCallback((toId: number, name?: string) => (
        startCallWithType(toId, name, 'video')
    ), [startCallWithType]);

    const acceptCall = useCallback(async () => {
        const fromId = peerUserIdRef.current;
        const offer = incomingOfferRef.current;
        const nextCallType = callTypeRef.current;

        if (!fromId || !offer) {
            return;
        }

        setError(null);

        try {
            const localStream = await getLocalStream(nextCallType);
            const pc = createPeerConnection(fromId);

            addStreamTracks(pc, localStream);
            await applyVideoSenderQuality(pc);

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            await flushPendingIce();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            wsService.sendCallAnswer(fromId, answer);
            setCallStatus('active');
        } catch (e) {
            console.error('Failed to accept call:', e);
            setError(getCallErrorMessage(e, 'Не удалось принять звонок'));
            wsService.sendCallReject(fromId);
            cleanupMediaSession();
        }
    }, [
        cleanupMediaSession,
        createPeerConnection,
        flushPendingIce,
        getLocalStream,
        setCallStatus,
        wsService,
    ]);

    const rejectCall = useCallback(() => {
        const fromId = peerUserIdRef.current;

        if (fromId) {
            wsService.sendCallReject(fromId);
        }

        cleanupCall();
    }, [cleanupCall, wsService]);

    const endCall = useCallback(() => {
        const toId = peerUserIdRef.current;

        if (toId) {
            wsService.sendCallEnd(toId);
        }

        cleanupCall();
    }, [cleanupCall, wsService]);

    useEffect(() => {
        const handleMessage = async (event: WsEvent) => {
            switch (event.type) {
                case 'call:offer': {
                    const { from_id: fromId, offer, call_type: incomingCallType } = event.payload;

                    if (fromId === currentUser?.id) {
                        return;
                    }

                    if (statusRef.current !== 'idle') {
                        wsService.sendCallReject(fromId);
                        return;
                    }

                    setError(null);
                    setCallPeer(fromId);
                    setCurrentCallType(incomingCallType === 'video' ? 'video' : 'audio');
                    incomingOfferRef.current = offer;
                    setCallStatus('incoming');
                    await loadPeerName(fromId);

                    return;
                }

                case 'call:answer': {
                    const { from_id: fromId, answer } = event.payload;

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

                case 'call:ice': {
                    const { from_id: fromId, candidate } = event.payload;

                    if (fromId !== peerUserIdRef.current) {
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

                case 'call:end':
                case 'call:reject': {
                    const { from_id: fromId } = event.payload;

                    if (fromId === peerUserIdRef.current) {
                        cleanupCall();
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
        currentUser?.id,
        flushPendingIce,
        loadPeerName,
        setCallPeer,
        setCallStatus,
        setCurrentCallType,
        wsService,
    ]);

    useEffect(() => {
        if (!currentUser && statusRef.current !== 'idle') {
            cleanupCall();
        }
    }, [cleanupCall, currentUser]);

    useEffect(() => {
        if (callType !== 'video') {
            return;
        }

        attachMediaStream(localVideoRef.current, localStreamRef.current);
        attachMediaStream(remoteVideoRef.current, remoteStreamRef.current);
    }, [callType, status]);

    useEffect(() => cleanupCall, [cleanupCall]);

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
                localVideoRef={localVideoRef}
                remoteVideoRef={remoteVideoRef}
                onToggleExpanded={() => setIsExpanded(prev => !prev)}
                onAccept={acceptCall}
                onReject={rejectCall}
                onEnd={endCall}
            />
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
