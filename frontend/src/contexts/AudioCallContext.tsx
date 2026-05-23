import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './AuthContext.js';
import { useWebSocket } from './WebSocketContext.js';

import { userService } from '../services/userService.js';

import type { WsEvent } from '../types/ws/events.js';

import { Avatar } from '../components/ui/Avatar.js';
import { Icon } from '../components/ui/Icon.js';

type CallStatus = 'idle' | 'incoming' | 'calling' | 'active';
type CallType = 'audio' | 'video';

const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};

const videoConstraints: MediaTrackConstraints = {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',
};

const videoSenderParams: RTCRtpEncodingParameters = {
    maxBitrate: 1_800_000,
    maxFramerate: 30,
    priority: 'high',
    networkPriority: 'high',
};

const getCallErrorMessage = (error: unknown, fallback: string) => {
    if (!(error instanceof Error)) {
        return fallback;
    }

    if (error.name === 'NotAllowedError') {
        return 'Нет доступа к камере или микрофону';
    }

    if (error.name === 'NotFoundError') {
        return 'Камера или микрофон не найдены';
    }

    if (error.name === 'NotReadableError') {
        return 'Камера или микрофон уже используются другим приложением';
    }

    return error.message || fallback;
};

type AudioCallContextValue = {
    status: CallStatus;
    callType: CallType;
    peerUserId: number | null;
    startCall: (toId: number, peerName?: string) => Promise<void>;
    startVideoCall: (toId: number, peerName?: string) => Promise<void>;
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
    const [callType, setCallType] = useState<CallType>('audio');
    const [peerUserId, setPeerUserId] = useState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    const statusRef = useRef<CallStatus>('idle');
    const callTypeRef = useRef<CallType>('audio');
    const peerUserIdRef = useRef<number | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
    const disconnectTimeoutRef = useRef<number | null>(null);

    const setCallStatus = useCallback((nextStatus: CallStatus) => {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
    }, []);

    const setCallPeer = useCallback((nextPeerId: number | null) => {
        peerUserIdRef.current = nextPeerId;
        setPeerUserId(nextPeerId);
    }, []);

    const setCurrentCallType = useCallback((nextCallType: CallType) => {
        callTypeRef.current = nextCallType;
        setCallType(nextCallType);
    }, []);

    const stopLocalStream = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
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

        if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
        }

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }

        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }
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
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Браузер не поддерживает доступ к камере и микрофону');
        }

        if (!localStreamRef.current) {
            try {
                localStreamRef.current = await navigator.mediaDevices.getUserMedia({
                    audio: audioConstraints,
                    video: nextCallType === 'video' ? videoConstraints : false,
                });
            } catch (e) {
                if (nextCallType !== 'video') {
                    throw e;
                }

                console.warn('Video input failed, falling back to audio-only call:', e);
                setError('Камера недоступна, звонок продолжен без видео');
                setCurrentCallType('audio');

                localStreamRef.current = await navigator.mediaDevices.getUserMedia({
                    audio: audioConstraints,
                    video: false,
                });
            }
        }

        return localStreamRef.current;
    }, [setCurrentCallType]);

    const applySenderQuality = useCallback(async (pc: RTCPeerConnection) => {
        const videoSender = pc.getSenders().find(sender => sender.track?.kind === 'video');

        if (!videoSender) {
            return;
        }

        const params = videoSender.getParameters();
        params.degradationPreference = 'maintain-resolution';
        params.encodings = params.encodings?.length
            ? params.encodings.map(encoding => ({
                ...encoding,
                ...videoSenderParams,
            }))
            : [videoSenderParams];

        try {
            await videoSender.setParameters(params);
        } catch (e) {
            console.warn('Failed to apply video sender quality:', e);
        }
    }, []);

    const flushPendingIce = useCallback(async () => {
        const pc = peerConnectionRef.current;

        if (!pc?.remoteDescription) {
            return;
        }

        const pendingCandidates = pendingIceRef.current;
        pendingIceRef.current = [];

        for (const candidate of pendingCandidates) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn('Failed to add pending ICE candidate:', e);
            }
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

            remoteStreamRef.current = remoteStream || null;

            if (remoteAudioRef.current && remoteStream) {
                remoteAudioRef.current.srcObject = remoteStream;
                remoteAudioRef.current.play().catch(() => undefined);
            }

            if (remoteVideoRef.current && remoteStream) {
                remoteVideoRef.current.srcObject = remoteStream;
                remoteVideoRef.current.play().catch(() => undefined);
            }
        };

        pc.onconnectionstatechange = () => {
            console.info('Call connection state:', pc.connectionState);

            if (pc.connectionState === 'connected') {
                if (disconnectTimeoutRef.current) {
                    window.clearTimeout(disconnectTimeoutRef.current);
                    disconnectTimeoutRef.current = null;
                }

                setCallStatus('active');
            }

            if (
                pc.connectionState === 'failed' ||
                pc.connectionState === 'closed'
            ) {
                cleanupCall();
            }

            if (pc.connectionState === 'disconnected' && !disconnectTimeoutRef.current) {
                disconnectTimeoutRef.current = window.setTimeout(() => {
                    disconnectTimeoutRef.current = null;

                    if (peerConnectionRef.current?.connectionState === 'disconnected') {
                        cleanupCall();
                    }
                }, 10000);
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

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            await applySenderQuality(pc);

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
        applySenderQuality,
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

            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });

            await applySenderQuality(pc);

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
        cleanupCall,
        cleanupMediaSession,
        applySenderQuality,
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

                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (e) {
                        console.warn('Failed to add ICE candidate:', e);
                    }

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

        if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
            localVideoRef.current.play().catch(() => undefined);
        }

        if (remoteVideoRef.current && remoteStreamRef.current) {
            remoteVideoRef.current.srcObject = remoteStreamRef.current;
            remoteVideoRef.current.play().catch(() => undefined);
        }
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

            {status !== 'idle' && (
                <div className={
                    isExpanded && callType === 'video'
                        ? 'fixed inset-0 z-50 flex flex-col bg-gray-950 text-white'
                        : 'fixed inset-x-3 bottom-3 z-50 rounded-lg bg-white p-3 shadow-xl border border-gray-200 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[min(440px,calc(100vw-32px))] sm:p-4'
                }>
                    {callType === 'video' && (
                        <div className={
                            isExpanded
                                ? 'relative flex-1 overflow-hidden bg-gray-950'
                                : 'mb-4 overflow-hidden rounded-lg bg-gray-900 aspect-video relative'
                        }>
                            <video
                                ref={remoteVideoRef}
                                autoPlay
                                playsInline
                                className="h-full w-full object-cover"
                            />

                            <video
                                ref={localVideoRef}
                                autoPlay
                                muted
                                playsInline
                                className={
                                    isExpanded
                                        ? 'absolute right-3 top-3 h-28 w-20 rounded-lg bg-gray-800 object-cover border border-white/30 shadow sm:h-36 sm:w-56'
                                        : 'absolute bottom-2 right-2 h-20 w-24 rounded-md bg-gray-800 object-cover border border-white/30 shadow sm:bottom-3 sm:right-3 sm:h-24 sm:w-32'
                                }
                            />

                            <button
                                type="button"
                                onClick={() => setIsExpanded(prev => !prev)}
                                className="absolute left-3 top-3 h-10 w-10 rounded-full bg-black/45 text-white hover:bg-black/60 flex items-center justify-center"
                                aria-label={isExpanded ? 'Свернуть видеозвонок' : 'Развернуть видеозвонок'}
                                title={isExpanded ? 'Свернуть' : 'На весь экран'}
                            >
                                <Icon name={isExpanded ? 'minimize' : 'maximize'} />
                            </button>
                        </div>
                    )}

                    <div className={isExpanded ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-16 sm:p-6 sm:pt-20' : 'flex items-center gap-3'}>
                        {!isExpanded && <Avatar name={peerName} />}

                        <div className={isExpanded ? 'min-w-0 text-center' : 'min-w-0 flex-1'}>
                            <p className={isExpanded ? 'truncate text-lg font-semibold text-white' : 'font-semibold text-gray-900 truncate'}>
                                {peerName}
                            </p>

                            <p className={isExpanded ? 'text-sm text-gray-200' : 'text-sm text-gray-500'}>
                                {status === 'incoming' && (callType === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок')}
                                {status === 'calling' && 'Звоним...'}
                                {status === 'active' && (callType === 'video' ? 'Видеозвонок идет' : 'Аудиозвонок идет')}
                            </p>

                            {error && (
                                <p className={isExpanded ? 'mt-1 text-xs text-red-200' : 'mt-1 text-xs text-red-500'}>
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className={isExpanded ? 'mt-5 flex justify-center gap-3' : 'mt-4 flex justify-end gap-2'}>
                            {status === 'incoming' && (
                                <button
                                    type="button"
                                    onClick={acceptCall}
                                    className={isExpanded ? 'h-12 w-12 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center' : 'h-10 w-10 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center'}
                                    aria-label="Принять звонок"
                                    title="Принять звонок"
                                >
                                    <Icon name="phone" />
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={status === 'incoming' ? rejectCall : endCall}
                                className={isExpanded ? 'h-12 w-12 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center' : 'h-10 w-10 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center'}
                                aria-label="Завершить звонок"
                                title="Завершить звонок"
                            >
                                <Icon name="phoneOff" />
                            </button>
                        </div>
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
