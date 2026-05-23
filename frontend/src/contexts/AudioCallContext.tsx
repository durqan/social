import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './AuthContext.js';
import { useWebSocket } from './WebSocketContext.js';

import { userService } from '../services/userService.js';

import type { WsEvent } from '../types/ws/events.js';

import { Avatar } from '../components/ui/Avatar.js';
import { Icon } from '../components/ui/Icon.js';

type CallStatus = 'idle' | 'incoming' | 'calling' | 'active';

type AudioCallContextValue = {
    status: CallStatus;
    peerUserId: number | null;
    startCall: (toId: number, peerName?: string) => Promise<void>;
};

const AudioCallContext = createContext<AudioCallContextValue | null>(null);

const parseTurnUrls = () => {
    const urls = import.meta.env.VITE_TURN_URLS;

    if (!urls) {
        return [];
    }

    return urls
        .split(',')
        .map(url => url.trim())
        .filter(Boolean);
};

const buildIceServers = (): RTCIceServer[] => {
    const turnUrls = parseTurnUrls();

    const iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
    ];

    if (turnUrls.length) {
        iceServers.push({
            urls: turnUrls,
            username: import.meta.env.VITE_TURN_USERNAME || undefined,
            credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
        });
    }

    return iceServers;
};

const rtcConfig: RTCConfiguration = {
    iceServers: buildIceServers(),
};

export const AudioCallProvider = ({ children }: { children: ReactNode }) => {
    const wsService = useWebSocket();
    const { currentUser } = useAuth();

    const [status, setStatus] = useState<CallStatus>('idle');
    const [peerUserId, setPeerUserId] = useState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [error, setError] = useState<string | null>(null);

    const statusRef = useRef<CallStatus>('idle');
    const peerUserIdRef = useRef<number | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

    const setCallStatus = useCallback((nextStatus: CallStatus) => {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
    }, []);

    const setCallPeer = useCallback((nextPeerId: number | null) => {
        peerUserIdRef.current = nextPeerId;
        setPeerUserId(nextPeerId);
    }, []);

    const stopLocalStream = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
    }, []);

    const cleanupCall = useCallback(() => {
        peerConnectionRef.current?.close();
        peerConnectionRef.current = null;
        incomingOfferRef.current = null;
        pendingIceRef.current = [];
        stopLocalStream();

        if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
        }

        setCallPeer(null);
        setPeerName('Пользователь');
        setCallStatus('idle');
    }, [setCallPeer, setCallStatus, stopLocalStream]);

    const getMicrophoneStream = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Браузер не поддерживает доступ к микрофону');
        }

        if (!localStreamRef.current) {
            localStreamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });
        }

        return localStreamRef.current;
    }, []);

    const flushPendingIce = useCallback(async () => {
        const pc = peerConnectionRef.current;

        if (!pc?.remoteDescription) {
            return;
        }

        const pendingCandidates = pendingIceRef.current;
        pendingIceRef.current = [];

        for (const candidate of pendingCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }, []);

    const createPeerConnection = useCallback((toId: number) => {
        const pc = new RTCPeerConnection(rtcConfig);

        pc.onicecandidate = event => {
            if (event.candidate) {
                wsService.sendCallIce(toId, event.candidate.toJSON());
            }
        };

        pc.ontrack = event => {
            const [remoteStream] = event.streams;

            if (remoteAudioRef.current && remoteStream) {
                remoteAudioRef.current.srcObject = remoteStream;
                remoteAudioRef.current.play().catch(() => undefined);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setCallStatus('active');
            }

            if (
                pc.connectionState === 'failed' ||
                pc.connectionState === 'closed' ||
                pc.connectionState === 'disconnected'
            ) {
                cleanupCall();
            }
        };

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

    const startCall = useCallback(async (toId: number, name?: string) => {
        if (!currentUser || statusRef.current !== 'idle') {
            return;
        }

        setError(null);
        setCallPeer(toId);
        setPeerName(name || 'Пользователь');
        setCallStatus('calling');

        try {
            const localStream = await getMicrophoneStream();
            const pc = createPeerConnection(toId);

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsService.sendCallOffer(toId, offer);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось начать звонок');
            cleanupCall();
        }
    }, [
        cleanupCall,
        createPeerConnection,
        currentUser,
        getMicrophoneStream,
        setCallPeer,
        setCallStatus,
        wsService,
    ]);

    const acceptCall = useCallback(async () => {
        const fromId = peerUserIdRef.current;
        const offer = incomingOfferRef.current;

        if (!fromId || !offer) {
            return;
        }

        setError(null);

        try {
            const localStream = await getMicrophoneStream();
            const pc = createPeerConnection(fromId);

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            await flushPendingIce();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            wsService.sendCallAnswer(fromId, answer);
            setCallStatus('active');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось принять звонок');
            wsService.sendCallReject(fromId);
            cleanupCall();
        }
    }, [
        cleanupCall,
        createPeerConnection,
        flushPendingIce,
        getMicrophoneStream,
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
                    const { from_id: fromId, offer } = event.payload;

                    if (fromId === currentUser?.id) {
                        return;
                    }

                    if (statusRef.current !== 'idle') {
                        wsService.sendCallReject(fromId);
                        return;
                    }

                    setError(null);
                    setCallPeer(fromId);
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

                    await pc.addIceCandidate(new RTCIceCandidate(candidate));

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
        wsService,
    ]);

    useEffect(() => {
        if (!currentUser && statusRef.current !== 'idle') {
            cleanupCall();
        }
    }, [cleanupCall, currentUser]);

    useEffect(() => cleanupCall, [cleanupCall]);

    const value = useMemo(() => ({
        status,
        peerUserId,
        startCall,
    }), [peerUserId, startCall, status]);

    return (
        <AudioCallContext.Provider value={value}>
            {children}

            <audio ref={remoteAudioRef} autoPlay />

            {status !== 'idle' && (
                <div className="fixed bottom-6 right-6 z-50 w-[min(360px,calc(100vw-32px))] rounded-lg bg-white shadow-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <Avatar name={peerName} />

                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-gray-900 truncate">
                                {peerName}
                            </p>

                            <p className="text-sm text-gray-500">
                                {status === 'incoming' && 'Входящий аудиозвонок'}
                                {status === 'calling' && 'Звоним...'}
                                {status === 'active' && 'Аудиозвонок идет'}
                            </p>

                            {error && (
                                <p className="mt-1 text-xs text-red-500">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                        {status === 'incoming' && (
                            <button
                                type="button"
                                onClick={acceptCall}
                                className="h-10 w-10 rounded-full bg-green-500 text-white hover:bg-green-600 flex items-center justify-center"
                                aria-label="Принять звонок"
                                title="Принять звонок"
                            >
                                <Icon name="phone" />
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={status === 'incoming' ? rejectCall : endCall}
                            className="h-10 w-10 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center"
                            aria-label="Завершить звонок"
                            title="Завершить звонок"
                        >
                            <Icon name="phoneOff" />
                        </button>
                    </div>
                </div>
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
