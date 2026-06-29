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
    NativeModules,
    PermissionsAndroid,
    Platform,
    Pressable,
    StyleSheet,
    StatusBar,
    Text,
    View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
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
    MediaStream as WebRTCMediaStream,
    mediaDevices,
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
    RTCView,
    type MediaStream,
    type MediaStreamTrack,
} from 'react-native-webrtc';
import NetInfo from '@react-native-community/netinfo';
import {WS_EVENTS} from '@social/shared';

import {
    callsApi,
    type ActiveCall,
    type RestoredCallIceCandidate,
} from '../api/calls';
import {userApi} from '../api/users';
import {
    chatSocket,
    type CallIceCandidate,
    type CallSessionDescription,
    type CallType,
    type WsEvent,
} from '../api/ws';
import {TURN_CREDENTIAL, TURN_URLS, TURN_USERNAME} from '../config/env';
import {useAppLifecycle} from './AppLifecycleContext';
import {useAuth} from './AuthContext';
import {
    clearPendingIncomingCall,
    consumePendingIncomingCall,
    rememberTerminalIncomingCall,
    subscribePendingIncomingCall,
    type PendingIncomingCallPush,
} from '../notifications/pendingIncomingCall';
import {cancelIncomingCallNotification} from '../notifications/localNotifications';
import {logDev, warnDev} from '../utils/logger';
import {registerCallShutdownHandler} from './callLifecycle';
import {
    isLiveServerCall,
    isTerminalCallStatus,
    shouldKeepLocalServerCall,
    shouldShowIncomingServerCall,
} from './callSync';

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

type BufferedOutgoingIceCandidate = {
    toId: number;
    candidate: CallIceCandidate;
};

type NativeCallAudioSession = {
    setCallActive: () => void;
    clearCallActive: () => void;
};

type SdpMediaSummary = {
    present: boolean;
    direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | 'missing';
};

type SdpSummary = {
    hasAudio: boolean;
    hasVideo: boolean;
    audio: SdpMediaSummary;
    video: SdpMediaSummary;
    hasSendrecv: boolean;
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
type VideoQualityProfileName = 'low' | 'medium' | 'high';
type VideoQualityProfile = {
    name: VideoQualityProfileName;
    width: number;
    height: number;
    frameRate: number;
    sender: {
        maxBitrate: number;
        maxFramerate: number;
    };
};
type ConstraintCapableTrack = MediaStreamTrack & {
    applyConstraints?: (
        constraints: ReturnType<typeof videoConstraints>,
    ) => Promise<void>;
};
type CallMediaConstraints = Parameters<typeof mediaDevices.getUserMedia>[0];

const CallContext = createContext<CallContextValue | undefined>(undefined);
const disconnectedCleanupDelayMs = 10000;
const callHeartbeatIntervalMs = 15000;
const maxIceRecoveryAttempts = 2;
const callAudioConstraints = {
    googEchoCancellation: true,
    googNoiseSuppression: true,
    googAutoGainControl: true,
    googHighpassFilter: true,
} as unknown as CallMediaConstraints['audio'];
const videoQualityProfiles = {
    low: {
        name: 'low',
        width: 426,
        height: 240,
        frameRate: 15,
        sender: {maxBitrate: 350000, maxFramerate: 15},
    },
    medium: {
        name: 'medium',
        width: 960,
        height: 540,
        frameRate: 30,
        sender: {maxBitrate: 1200000, maxFramerate: 30},
    },
    high: {
        name: 'high',
        width: 1920,
        height: 1080,
        frameRate: 30,
        sender: {maxBitrate: 3200000, maxFramerate: 30},
    },
} satisfies Record<VideoQualityProfileName, VideoQualityProfile>;
const highFallbackProfile: VideoQualityProfile = {
    name: 'high',
    width: 1280,
    height: 720,
    frameRate: 30,
    sender: {maxBitrate: 2400000, maxFramerate: 30},
};
const absoluteFillObject =
    (
        StyleSheet as typeof StyleSheet & {
            absoluteFillObject?: typeof StyleSheet.absoluteFill;
        }
    ).absoluteFillObject ?? StyleSheet.absoluteFill;
const nativeCallAudioSession = (
    NativeModules as {CallAudioSession?: NativeCallAudioSession}
).CallAudioSession;

function setNativeCallSessionActive(active: boolean) {
    if (Platform.OS !== 'android') {
        return;
    }

    try {
        if (active) {
            nativeCallAudioSession?.setCallActive();
        } else {
            nativeCallAudioSession?.clearCallActive();
        }
    } catch (nativeError) {
        warnDev('[SocialMobile] Failed to update native call audio session', {
            active,
            error: nativeError,
        });
    }
}

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
    }> = [{urls: 'stun:stun.l.google.com:19302'}];

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

async function initialVideoQualityProfile(networkConnected: boolean) {
    if (!networkConnected) {
        return videoQualityProfiles.low;
    }

    try {
        const state = await NetInfo.fetch();
        if (state.type === 'cellular') {
            const generation = state.details?.cellularGeneration;
            if (generation === '2g' || generation === '3g') {
                return videoQualityProfiles.low;
            }
            if (generation === '5g') {
                return Platform.OS === 'android' && Number(Platform.Version) < 26
                    ? highFallbackProfile
                    : videoQualityProfiles.high;
            }
            if (generation === '4g') {
                return highFallbackProfile;
            }
            return videoQualityProfiles.medium;
        }
    } catch {
        return videoQualityProfiles.medium;
    }

    return Platform.OS === 'android' && Number(Platform.Version) < 26
        ? videoQualityProfiles.medium
        : videoQualityProfiles.high;
}

function isSameVideoProfile(
    left: VideoQualityProfile,
    right: VideoQualityProfile,
) {
    return (
        left.name === right.name &&
        left.width === right.width &&
        left.height === right.height &&
        left.frameRate === right.frameRate
    );
}

function videoProfileFallbackChain(profile: VideoQualityProfile) {
    if (profile.name === 'high') {
        const chain = [
            videoQualityProfiles.high,
            highFallbackProfile,
            videoQualityProfiles.medium,
            videoQualityProfiles.low,
        ];
        const startIndex = chain.findIndex(candidate =>
            isSameVideoProfile(candidate, profile),
        );

        return startIndex > 0 ? chain.slice(startIndex) : chain;
    }
    if (profile.name === 'medium') {
        return [videoQualityProfiles.medium, videoQualityProfiles.low];
    }
    return [videoQualityProfiles.low];
}

function videoConstraints(profile: VideoQualityProfile) {
    return {
        facingMode: 'user',
        width: profile.width,
        height: profile.height,
        frameRate: profile.frameRate,
    };
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

function summarizeTrack(track: MediaStreamTrack) {
    return {
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
    };
}

function summarizeStreamTracks(stream: MediaStream) {
    return stream.getTracks().map(summarizeTrack);
}

function sectionDirection(section: string, fallback = 'sendrecv') {
    return (
        section.match(/^a=(sendrecv|sendonly|recvonly|inactive)\r?$/m)?.[1] ??
        fallback
    );
}

function summarizeSdp(sdp?: string | null): SdpSummary {
    const text = sdp ?? '';
    const sessionDirection = sectionDirection(text.split(/\r?\nm=/)[0] ?? '');
    const mediaSections = text
        .split(/\r?\nm=/)
        .slice(1)
        .map(section => `m=${section}`);
    const audioSection = mediaSections.find(section =>
        section.startsWith('m=audio'),
    );
    const videoSection = mediaSections.find(section =>
        section.startsWith('m=video'),
    );
    const audioDirection = audioSection
        ? sectionDirection(audioSection, sessionDirection)
        : 'missing';
    const videoDirection = videoSection
        ? sectionDirection(videoSection, sessionDirection)
        : 'missing';

    return {
        hasAudio: Boolean(audioSection),
        hasVideo: Boolean(videoSection),
        audio: {
            present: Boolean(audioSection),
            direction: audioDirection as SdpMediaSummary['direction'],
        },
        video: {
            present: Boolean(videoSection),
            direction: videoDirection as SdpMediaSummary['direction'],
        },
        hasSendrecv: audioDirection === 'sendrecv' || videoDirection === 'sendrecv',
    };
}

function sessionDescriptionForSignal(
    description:
        | CallSessionDescription
        | InstanceType<typeof RTCSessionDescription>
        | null
        | undefined,
    fallback?: CallSessionDescription,
): CallSessionDescription {
    return {
        type: description?.type ?? fallback?.type ?? null,
        sdp: description?.sdp ?? fallback?.sdp ?? '',
    };
}

function warnIfOfferSdpNotBidirectional(
    summary: SdpSummary,
    callType: CallType,
    callId: string,
    pcId: number | null,
) {
    if (
        !summary.hasAudio ||
        summary.audio.direction !== 'sendrecv' ||
        (callType === 'video' &&
            (!summary.hasVideo || summary.video.direction !== 'sendrecv'))
    ) {
        warnDev('[SocialMobile] Mobile offer SDP is not bidirectional', {
            callId,
            pcId,
            callType,
            summary,
        });
    }
}

function isUsableIceCandidate(
    candidate: CallIceCandidate | null | undefined,
): candidate is CallIceCandidate {
    return (
        typeof candidate?.candidate === 'string' &&
        candidate.candidate.trim().length > 0
    );
}

function iceCandidateFromId(candidate: RestoredCallIceCandidate) {
    if (typeof candidate.from_id === 'number') {
        return candidate.from_id;
    }
    if (typeof candidate.fromId === 'number') {
        return candidate.fromId;
    }
    return undefined;
}

function iceCandidateDedupKey(
    candidate: CallIceCandidate,
    fromId?: number | null,
) {
    return [
        fromId ?? '',
        candidate.candidate,
        candidate.sdpMid ?? '',
        candidate.sdpMLineIndex ?? '',
    ].join('|');
}

function withIceCandidateFromId(
    candidate: CallIceCandidate,
    fromId: number,
): RestoredCallIceCandidate {
    return {
        ...candidate,
        from_id: fromId,
    };
}

function callPeerId(call: ActiveCall, userId: number) {
    return call.caller_id === userId ? call.callee_id : call.caller_id;
}

async function addIceCandidateSafely(
    pc: PeerConnection,
    candidate: CallIceCandidate | null | undefined,
    context: string,
    details: {
        callId?: string | null;
        pcId?: number | null;
        fromId?: number;
    } = {},
) {
    if (!isUsableIceCandidate(candidate)) {
        logDev('[SocialMobile] Skipping empty ICE candidate', {
            context,
            ...details,
        });
        return false;
    }

    try {
        logDev('[SocialMobile] Adding ICE candidate', {
            context,
            ...details,
            type: iceCandidateType(candidate),
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
        });
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        if (context === 'restored') {
            logDev('[SocialMobile] addIceCandidate restored', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
        } else {
            logDev('[SocialMobile] ICE candidate added', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
        }
        return true;
    } catch (error) {
        warnDev('[SocialMobile] Failed to add ICE candidate', {
            context,
            ...details,
            error,
            candidate,
        });
        return false;
    }
}

function logPeerState(
    pc: PeerConnection,
    callId: string,
    event: string,
    pcId?: number | null,
) {
    logDev('[SocialMobile] Call peer state', {
        callId,
        pcId,
        nativePcId: pc._pcId,
        event,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
    });
}

function logIceServers(
    servers: ReturnType<typeof iceServers>,
    callId: string,
    pcId?: number | null,
) {
    console.log('[SocialMobile] ICE config before pc', JSON.stringify({
        callId,
        pcId,
        iceServers: servers.map(server => ({
            urls: server.urls,
            hasUsername: Boolean(server.username),
            usernameLen: server.username?.length ?? 0,
            hasCredential: Boolean(server.credential),
            credentialLen: server.credential?.length ?? 0,
        })),
    }));
}

async function applyVideoSenderQuality(
    pc: PeerConnection | null,
    profile: VideoQualityProfile | null | undefined,
    callId?: string | null,
    pcId?: number | null,
) {
    if (!pc) {
        return;
    }

    const sender = pc.getSenders().find(item => item.track?.kind === 'video');
    if (!sender) {
        return;
    }

    try {
        const senderQuality = profile?.sender ?? highFallbackProfile.sender;
        const parameters = sender.getParameters();
        parameters.degradationPreference = 'maintain-resolution';
        if (parameters.encodings.length === 0) {
            parameters.encodings = [
                {
                    active: true,
                    ...senderQuality,
                },
            ];
        } else {
            parameters.encodings.forEach(encoding => {
                encoding.maxBitrate = senderQuality.maxBitrate;
                encoding.maxFramerate = senderQuality.maxFramerate;
            });
        }
        await sender.setParameters(parameters);
        logDev('[SocialMobile] Video sender quality applied', {
            callId,
            pcId,
            profile,
            ...senderQuality,
        });
    } catch (qualityError) {
        warnDev('[SocialMobile] Failed to apply video sender quality', {
            callId,
            pcId,
            error: qualityError,
        });
    }
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
    connecting: new Set([
        'connecting',
        'ringing',
        'active',
        'ended',
        'error',
        'idle',
    ]),
    ringing: new Set([
        'ringing',
        'connecting',
        'active',
        'ended',
        'error',
        'idle',
    ]),
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

export function CallProvider({children}: { children: ReactNode }) {
    const {user} = useAuth();
    const {appState, networkConnected, resumeCount} = useAppLifecycle();
    const [status, setStatus] = useState<CallStatus>('idle');
    const [callType, setCallType] = useState<CallType>('audio');
    const [peerUserId, setPeerUserId] = useState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [microphoneOn, setMicrophoneOn] = useState(true);
    const [cameraOn, setCameraOn] = useState(true);
    const [frontCamera, setFrontCamera] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const statusRef = useRef(status);
    const peerUserIdRef = useRef(peerUserId);
    const callTypeRef = useRef(callType);
    const networkConnectedRef = useRef(networkConnected);
    const localVideoProfileRef = useRef<VideoQualityProfile | null>(null);
    const pcRef = useRef<PeerConnection | null>(null);
    const pcCallIdRef = useRef<string | null>(null);
    const pcIdsRef = useRef(new WeakMap<PeerConnection, number>());
    const pcSequenceRef = useRef(0);
    const localOfferPeerRef = useRef<{
        callId: string;
        pcId: number;
    } | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const callIdRef = useRef<string | null>(null);
    const pendingOfferRef = useRef<PendingOffer | null>(null);
    const pendingIncomingCallPushRef = useRef<PendingIncomingCallPush | null>(
        null,
    );
    const hydratingCallIdsRef = useRef(new Set<string>());
    const hydratingActiveRef = useRef(false);
    const pendingIceRef = useRef<RestoredCallIceCandidate[]>([]);
    const outgoingIceBufferRef = useRef(
        new Map<string, BufferedOutgoingIceCandidate[]>(),
    );
    const signalingReadyCallIdsRef = useRef(new Set<string>());
    const appliedRemoteIceKeysRef = useRef(new Set<string>());
    const seenCallEventsRef = useRef(new Set<string>());
    const startInFlightRef = useRef(false);
    const acceptInFlightRef = useRef(false);
    const terminalActionInFlightRef = useRef(new Set<string>());
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

    useEffect(() => {
        networkConnectedRef.current = networkConnected;
    }, [networkConnected]);

    const callSessionActive =
        status !== 'idle' && status !== 'ended' && status !== 'error';

    useEffect(() => {
        setNativeCallSessionActive(callSessionActive);
    }, [appState, callSessionActive, status]);

    useEffect(() => {
        return () => {
            setNativeCallSessionActive(false);
        };
    }, []);

    const setCallStatus = useCallback(
        (nextStatus: CallStatus, reason = 'state_update') => {
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
        },
        [],
    );

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

    const getPeerConnectionId = useCallback((pc: PeerConnection | null) => {
        if (!pc) {
            return null;
        }

        return pcIdsRef.current.get(pc) ?? null;
    }, []);

    const closePeerConnection = useCallback(() => {
        clearDisconnectTimer();
        const pc = pcRef.current;
        if (pc) {
            logDev('[SocialMobile] Closing call peer connection', {
                callId: pcCallIdRef.current,
                pcId: pcIdsRef.current.get(pc) ?? null,
                nativePcId: pc._pcId,
            });
        }
        pcListenerCleanupRef.current?.();
        pcListenerCleanupRef.current = null;
        pc?.close();
        pcRef.current = null;
        pcCallIdRef.current = null;
    }, [clearDisconnectTimer]);

    const sendTerminalCallAction = useCallback(
        (action: 'end' | 'reject', targetId: number, callId: string) => {
            const key = `${action}:${callId}`;
            if (terminalActionInFlightRef.current.has(key)) {
                return;
            }
            terminalActionInFlightRef.current.add(key);

            const request =
                action === 'reject'
                    ? callsApi.rejectCall(callId)
                    : callsApi.endCall(callId);
            request
                .catch(terminalError => {
                    warnDev('[SocialMobile] Call terminal REST action failed', {
                        action,
                        callId,
                        error: terminalError,
                    });
                    try {
                        if (action === 'reject') {
                            chatSocket.sendCallReject(targetId, callId);
                        } else {
                            chatSocket.sendCallEnd(targetId, callId);
                        }
                    } catch (sendError) {
                        warnDev('[SocialMobile] Call terminal WS fallback failed', {
                            action,
                            callId,
                            sendError,
                        });
                    }
                })
                .finally(() => {
                    terminalActionInFlightRef.current.delete(key);
                });
        },
        [],
    );

    const sendOrBufferOutgoingIce = useCallback(
        (toId: number, candidate: CallIceCandidate, callId: string) => {
            if (!signalingReadyCallIdsRef.current.has(callId)) {
                const buffered = outgoingIceBufferRef.current.get(callId) ?? [];
                buffered.push({toId, candidate});
                outgoingIceBufferRef.current.set(callId, buffered.slice(-64));
                logDev('[SocialMobile] Buffering outgoing ICE before signaling ready', {
                    callId,
                    pcId: getPeerConnectionId(pcRef.current),
                    toId,
                    type: iceCandidateType(candidate),
                });
                return;
            }

            chatSocket.sendCallIce(toId, candidate, callId);
        },
        [getPeerConnectionId],
    );

    const markCallSignalingReady = useCallback(
        (callId: string, toId: number) => {
            signalingReadyCallIdsRef.current.add(callId);
            const buffered = outgoingIceBufferRef.current.get(callId) ?? [];
            outgoingIceBufferRef.current.delete(callId);
            logDev('[SocialMobile] Call signaling ready; flushing outgoing ICE', {
                callId,
                pcId: getPeerConnectionId(pcRef.current),
                bufferedIce: buffered.length,
            });
            buffered.forEach(item => {
                const targetId = item.toId || toId;
                if (callIdRef.current === callId) {
                    chatSocket.sendCallIce(targetId, item.candidate, callId);
                }
            });
        },
        [getPeerConnectionId],
    );

    const resetCall = useCallback(() => {
        const callId = callIdRef.current;

        if (callId) {
            chatSocket.discardPendingCallEvents(callId);
            cancelIncomingCallNotification(callId).catch(() => undefined);
        }
        clearPendingIncomingCall().catch(() => undefined);

        clearEndTimer();
        closePeerConnection();
        stopStream(localStreamRef.current);
        localStreamRef.current = null;
        localVideoProfileRef.current = null;
        stopStream(remoteStreamRef.current);
        remoteStreamRef.current = null;
        callIdRef.current = null;
        pcCallIdRef.current = null;
        localOfferPeerRef.current = null;
        pendingOfferRef.current = null;
        pendingIncomingCallPushRef.current = null;
        pendingIceRef.current = [];
        outgoingIceBufferRef.current.clear();
        signalingReadyCallIdsRef.current.clear();
        appliedRemoteIceKeysRef.current.clear();
        seenCallEventsRef.current.clear();
        startInFlightRef.current = false;
        acceptInFlightRef.current = false;
        iceRecoveryAttemptsRef.current = 0;
        setLocalStream(null);
        setRemoteStream(null);
        setMicrophoneOn(true);
        setCameraOn(true);
        setFrontCamera(true);
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
                rememberTerminalIncomingCall(callId).catch(() => undefined);
            }
            clearPendingIncomingCall(callId).catch(() => undefined);

            if (notifyPeer && targetId && callId) {
                sendTerminalCallAction('end', targetId, callId);
            }

            clearEndTimer();
            closePeerConnection();
            stopStream(localStreamRef.current);
            localStreamRef.current = null;
            localVideoProfileRef.current = null;
            stopStream(remoteStreamRef.current);
            remoteStreamRef.current = null;
            callIdRef.current = null;
            pcCallIdRef.current = null;
            localOfferPeerRef.current = null;
            pendingOfferRef.current = null;
            pendingIncomingCallPushRef.current = null;
            pendingIceRef.current = [];
            outgoingIceBufferRef.current.clear();
            signalingReadyCallIdsRef.current.clear();
            appliedRemoteIceKeysRef.current.clear();
            startInFlightRef.current = false;
            acceptInFlightRef.current = false;
            iceRecoveryAttemptsRef.current = 0;
            setLocalStream(null);
            setRemoteStream(null);
            setMicrophoneOn(true);
            setCameraOn(true);
            setFrontCamera(true);
            setError(message ?? null);
            setCallStatus(nextStatus, 'finish');
            endTimerRef.current = setTimeout(resetCall, 1800);
        },
        [
            clearEndTimer,
            closePeerConnection,
            resetCall,
            sendTerminalCallAction,
            setCallStatus,
        ],
    );

    const loadPeerName = useCallback(
        async (userId: number, fallback?: string, expectedCallId?: string) => {
            const isCurrentPeer = () =>
                peerUserIdRef.current === userId &&
                (!expectedCallId || callIdRef.current === expectedCallId) &&
                statusRef.current !== 'idle' &&
                statusRef.current !== 'ended' &&
                statusRef.current !== 'error';

            if (fallback) {
                if (isCurrentPeer()) {
                    setPeerName(fallback);
                }
                return;
            }

            try {
                const profile = await userApi.getUser(userId);
                if (isCurrentPeer()) {
                    setPeerName(profile.name || 'Пользователь');
                }
            } catch {
                if (isCurrentPeer()) {
                    setPeerName('Пользователь');
                }
            }
        },
        [],
    );

    const queuePendingIceCandidate = useCallback(
        (
            candidate: RestoredCallIceCandidate,
            fromId: number | undefined,
            source: string,
        ) => {
            const key = iceCandidateDedupKey(candidate, fromId);
            if (
                pendingIceRef.current.some(
                    pending =>
                        iceCandidateDedupKey(pending, iceCandidateFromId(pending)) === key,
                )
            ) {
                logDev('[SocialMobile] Duplicate pending ICE candidate ignored', {
                    source,
                    callId: callIdRef.current,
                    pcId: getPeerConnectionId(pcRef.current),
                    fromId,
                    type: iceCandidateType(candidate),
                });
                return;
            }

            pendingIceRef.current.push(candidate);
            logDev('[SocialMobile] Queuing ICE candidate until remoteDescription', {
                source,
                callId: callIdRef.current,
                pcId: getPeerConnectionId(pcRef.current),
                fromId,
                type: iceCandidateType(candidate),
                bufferedIce: pendingIceRef.current.length,
            });
        },
        [getPeerConnectionId],
    );

    const flushPendingIce = useCallback(async () => {
        const pc = pcRef.current;
        if (!pc?.remoteDescription) {
            logDev('[SocialMobile] Buffered ICE flush skipped', {
                callId: callIdRef.current,
                pcId: getPeerConnectionId(pc),
                hasPeerConnection: Boolean(pc),
                hasRemoteDescription: Boolean(pc?.remoteDescription),
                bufferedIce: pendingIceRef.current.length,
            });
            return;
        }

        const pending = pendingIceRef.current.splice(0);
        pendingIceRef.current = [];
        logDev('[SocialMobile] Flushing buffered ICE candidates', {
            callId: pcCallIdRef.current,
            pcId: getPeerConnectionId(pc),
            count: pending.length,
        });
        for (const candidate of pending) {
            const fromId = iceCandidateFromId(candidate);
            const key = iceCandidateDedupKey(candidate, fromId);
            if (appliedRemoteIceKeysRef.current.has(key)) {
                continue;
            }
            const added = await addIceCandidateSafely(pc, candidate, 'pending', {
                callId: pcCallIdRef.current,
                pcId: getPeerConnectionId(pc),
                fromId,
            });
            if (added) {
                appliedRemoteIceKeysRef.current.add(key);
            }
        }
    }, [getPeerConnectionId]);

    const applyRestoredIceCandidates = useCallback(
        async (call: ActiveCall, reason: string) => {
            const userId = user?.id;
            if (!userId) {
                return;
            }

            const pc = pcRef.current;
            const peerId = peerUserIdRef.current ?? callPeerId(call, userId);
            const pcId = getPeerConnectionId(pc);
            const restoredCandidates = (call.ice_candidates ?? []).filter(
                candidate => {
                    if (!isUsableIceCandidate(candidate)) {
                        return false;
                    }
                    const fromId = iceCandidateFromId(candidate);
                    if (fromId && fromId === userId) {
                        return false;
                    }
                    if (fromId && peerId && fromId !== peerId) {
                        return false;
                    }
                    return true;
                },
            );

            logDev('[SocialMobile] Active call restored ICE candidates', {
                reason,
                callId: call.call_id,
                pcId,
                totalIce: call.ice_candidates?.length ?? 0,
                remoteIce: restoredCandidates.length,
            });

            if (!pc || pcCallIdRef.current !== call.call_id) {
                logDev('[SocialMobile] Restored ICE skipped without current PC', {
                    reason,
                    callId: call.call_id,
                    pcCallId: pcCallIdRef.current,
                    pcId,
                    remoteIce: restoredCandidates.length,
                });
                return;
            }

            for (const candidate of restoredCandidates) {
                const fromId = iceCandidateFromId(candidate);
                const key = iceCandidateDedupKey(candidate, fromId);
                if (appliedRemoteIceKeysRef.current.has(key)) {
                    continue;
                }
                if (!pc.remoteDescription) {
                    queuePendingIceCandidate(candidate, fromId, 'restored');
                    continue;
                }
                const added = await addIceCandidateSafely(pc, candidate, 'restored', {
                    callId: call.call_id,
                    pcId,
                    fromId,
                });
                if (added) {
                    appliedRemoteIceKeysRef.current.add(key);
                }
            }
        },
        [getPeerConnectionId, queuePendingIceCandidate, user?.id],
    );

    const restoreActiveCallState = useCallback(
        async (call: ActiveCall, reason: string) => {
            const userId = user?.id;
            if (!userId || callIdRef.current !== call.call_id) {
                return false;
            }

            const peerId = callPeerId(call, userId);
            const pc = pcRef.current;
            const pcId = getPeerConnectionId(pc);
            const restoredIceCount = call.ice_candidates?.length ?? 0;

            logDev('[SocialMobile] Active call restore', {
                reason,
                callId: call.call_id,
                pcId,
                localStatus: statusRef.current,
                serverStatus: call.status,
                peerId,
                hasOffer: Boolean(call.offer),
                hasAnswer: Boolean(call.answer),
                restoredIceCount,
            });

            if (peerUserIdRef.current !== peerId) {
                setCallPeer(peerId);
            }
            setCurrentCallType(call.call_type === 'video' ? 'video' : 'audio');

            if (
                call.offer &&
                call.callee_id === userId &&
                (statusRef.current === 'incoming' || statusRef.current === 'connecting')
            ) {
                pendingOfferRef.current = {
                    fromId: call.caller_id,
                    callId: call.call_id,
                    offer: call.offer,
                    callType: call.call_type === 'video' ? 'video' : 'audio',
                };
            }

            if (
                call.answer &&
                call.caller_id === userId &&
                pc &&
                pcCallIdRef.current === call.call_id &&
                !pc.remoteDescription
            ) {
                logDev('[SocialMobile] Restoring call answer', {
                    callId: call.call_id,
                    pcId,
                    answer: summarizeSdp(call.answer.sdp),
                });
                await pc.setRemoteDescription(new RTCSessionDescription(call.answer));
                if (pcRef.current !== pc || callIdRef.current !== call.call_id) {
                    return false;
                }
                logPeerState(pc, call.call_id, 'remote-answer-restored', pcId);
                await flushPendingIce();
                if (statusRef.current !== 'active') {
                    setCallStatus('connecting', 'answer_restored_waiting_for_media');
                }
            }

            await applyRestoredIceCandidates(call, reason);
            return true;
        },
        [
            applyRestoredIceCandidates,
            flushPendingIce,
            getPeerConnectionId,
            setCallPeer,
            setCallStatus,
            setCurrentCallType,
            user?.id,
        ],
    );

    const showHydratedIncomingCall = useCallback(
        async (call: ActiveCall, fallbackName?: string) => {
            if (!shouldShowIncomingServerCall(call, user?.id)) {
                return false;
            }

            if (
                statusRef.current !== 'idle' &&
                !(
                    statusRef.current === 'incoming' && callIdRef.current === call.call_id
                )
            ) {
                return false;
            }

            pendingOfferRef.current = {
                fromId: call.caller_id,
                callId: call.call_id,
                offer: call.offer!,
                callType: call.call_type === 'video' ? 'video' : 'audio',
            };
            pendingIceRef.current = call.ice_candidates ?? [];
            logDev('[SocialMobile] Incoming active call restored', {
                callId: call.call_id,
                pcId: getPeerConnectionId(pcRef.current),
                hasOffer: Boolean(call.offer),
                hasAnswer: Boolean(call.answer),
                restoredIceCount: pendingIceRef.current.length,
                status: call.status,
            });
            pendingIncomingCallPushRef.current = null;
            callIdRef.current = call.call_id;
            setCallPeer(call.caller_id);
            setCurrentCallType(call.call_type === 'video' ? 'video' : 'audio');
            setError(null);
            setCallStatus('incoming');
            await loadPeerName(
                call.caller_id,
                fallbackName ?? call.caller?.name,
                call.call_id,
            );
            return true;
        },
        [
            getPeerConnectionId,
            loadPeerName,
            setCallPeer,
            setCallStatus,
            setCurrentCallType,
            user?.id,
        ],
    );

    const hydrateIncomingCall = useCallback(
        async (callId?: string | null, fallbackName?: string) => {
            const userId = user?.id;
            if (!userId) {
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
                const currentCallId = callIdRef.current;

                if (!call) {
                    if (
                        currentCallId &&
                        startInFlightRef.current &&
                        statusRef.current === 'connecting'
                    ) {
                        logDev(
                            '[SocialMobile] Active call hydrate skipped during outgoing setup',
                            {
                                callId: currentCallId,
                            },
                        );
                        return;
                    }

                    if (
                        currentCallId &&
                        (!normalizedCallId || currentCallId === normalizedCallId) &&
                        statusRef.current !== 'idle' &&
                        statusRef.current !== 'ended' &&
                        statusRef.current !== 'error'
                    ) {
                        finishCall('ended');
                    }
                    if (normalizedCallId) {
                        await rememberTerminalIncomingCall(normalizedCallId).catch(
                            () => undefined,
                        );
                    }
                    return;
                }

                if (isTerminalCallStatus(call.status) || !isLiveServerCall(call)) {
                    await rememberTerminalIncomingCall(call.call_id).catch(
                        () => undefined,
                    );
                    if (
                        callIdRef.current === call.call_id &&
                        statusRef.current !== 'idle'
                    ) {
                        finishCall('ended');
                    } else if (
                        pendingIncomingCallPushRef.current?.callId === call.call_id
                    ) {
                        pendingIncomingCallPushRef.current = null;
                        clearPendingIncomingCall(call.call_id).catch(() => undefined);
                        cancelIncomingCallNotification(call.call_id).catch(() => undefined);
                    }
                    return;
                }

                if (shouldKeepLocalServerCall(call, currentCallId)) {
                    logDev('[SocialMobile] Active call hydrate kept local call', {
                        callId: call.call_id,
                        status: call.status,
                        localStatus: statusRef.current,
                        pcId: getPeerConnectionId(pcRef.current),
                        hasOffer: Boolean(call.offer),
                        hasAnswer: Boolean(call.answer),
                        iceCandidates: call.ice_candidates?.length ?? 0,
                    });
                    await restoreActiveCallState(
                        call,
                        normalizedCallId ? 'call_id_restore' : 'active_restore',
                    );
                    if (
                        statusRef.current === 'incoming' &&
                        shouldShowIncomingServerCall(call, userId)
                    ) {
                        await showHydratedIncomingCall(call, fallbackName);
                    }
                    return;
                }

                if (await showHydratedIncomingCall(call, fallbackName)) {
                    return;
                }

                if (statusRef.current !== 'idle') {
                    if (shouldShowIncomingServerCall(call, userId)) {
                        callsApi.rejectCall(call.call_id).catch(() => undefined);
                    }
                    return;
                }

                if (isLiveServerCall(call)) {
                    callsApi.endCall(call.call_id).catch(() => undefined);
                    await rememberTerminalIncomingCall(call.call_id).catch(
                        () => undefined,
                    );
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
        [
            finishCall,
            getPeerConnectionId,
            restoreActiveCallState,
            showHydratedIncomingCall,
            user?.id,
        ],
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
        let selectedProfile: VideoQualityProfile | null = null;
        try {
            if (nextCallType === 'video') {
                const initialProfile = await initialVideoQualityProfile(
                    networkConnectedRef.current,
                );
                let lastVideoError: unknown = null;
                for (const profile of videoProfileFallbackChain(initialProfile)) {
                    try {
                        logDev('[SocialMobile] getUserMedia requested for video call', {
                            profile,
                        });
                        stream = await mediaDevices.getUserMedia({
                            audio: callAudioConstraints,
                            video: videoConstraints(profile),
                        });
                        selectedProfile = profile;
                        break;
                    } catch (profileError) {
                        lastVideoError = profileError;
                        warnDev('[SocialMobile] Video profile failed, trying fallback', {
                            profile,
                            error: profileError,
                        });
                    }
                }
                if (!stream) {
                    throw lastVideoError || new Error('call video track missing');
                }
            } else {
                logDev('[SocialMobile] getUserMedia requested for audio call');
                stream = await mediaDevices.getUserMedia({
                    audio: callAudioConstraints,
                    video: false,
                });
            }

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
                tracks: summarizeStreamTracks(stream),
            });
            logDev('[SocialMobile] getUserMedia success', {
                callType: nextCallType,
                tracks: summarizeStreamTracks(stream),
            });

            localStreamRef.current = stream;
            localVideoProfileRef.current = selectedProfile;
            setLocalStream(stream);
            setMicrophoneOn(true);
            setCameraOn(videoTracks.length > 0);
            setFrontCamera(true);
            return stream;
        } catch (streamError) {
            if (stream) {
                stopStream(stream);
            }

            warnDev('[SocialMobile] getUserMedia error', {
                callType: nextCallType,
                error: streamError,
            });
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

    const applyLocalVideoProfile = useCallback(
        async (profile: VideoQualityProfile) => {
            if (callTypeRef.current !== 'video') {
                return false;
            }

            const track = localStreamRef.current?.getVideoTracks()[0] as
                | ConstraintCapableTrack
                | undefined;
            if (!track || track.readyState === 'ended' || !track.applyConstraints) {
                return false;
            }

            try {
                await track.applyConstraints(videoConstraints(profile));
                localVideoProfileRef.current = profile;
                await applyVideoSenderQuality(
                    pcRef.current,
                    profile,
                    callIdRef.current,
                    getPeerConnectionId(pcRef.current),
                );
                logDev('[SocialMobile] Local video profile applied', {
                    profile,
                    callId: callIdRef.current,
                });
                return true;
            } catch (profileError) {
                warnDev('[SocialMobile] Failed to apply local video profile', {
                    profile,
                    callId: callIdRef.current,
                    error: profileError,
                });
                return false;
            }
        },
        [getPeerConnectionId],
    );

    const createPeerConnection = useCallback(
        (toId: number, callId: string) => {
            const existingPc = pcRef.current;
            if (existingPc && pcCallIdRef.current === callId) {
                logDev('[SocialMobile] Reusing existing call peer connection', {
                    callId,
                    pcId: getPeerConnectionId(existingPc),
                    nativePcId: existingPc._pcId,
                    toId,
                });
                return existingPc;
            }

            closePeerConnection();

            const servers = iceServers();
            const pc = new RTCPeerConnection({
                iceServers: servers,
            });
            const pcId = pcSequenceRef.current + 1;
            pcSequenceRef.current = pcId;
            pcIdsRef.current.set(pc, pcId);
            pcCallIdRef.current = callId;
            logIceServers(servers, callId, pcId);
            const eventTarget = pc as unknown as PeerConnectionEventTarget;
            const peerHandlers = pc as unknown as PeerConnectionHandlers;
            const isCurrentConnection = () =>
                pcRef.current === pc &&
                pcCallIdRef.current === callId &&
                callIdRef.current === callId;

          const updateRemoteStream = (stream: MediaStream) => {
            const existingTracks = remoteStreamRef.current?.getTracks() ?? [];
            const incomingTracks = stream.getTracks();

            const tracksById = new Map<string, MediaStreamTrack>();

            [...existingTracks, ...incomingTracks].forEach(track => {
              if (track.readyState === 'live') {
                tracksById.set(track.id, track);
              }
            });

            const nextStream = new WebRTCMediaStream(
                Array.from(tracksById.values()),
            ) as MediaStream;

            remoteStreamRef.current = nextStream;
            setRemoteStream(nextStream);

            const hasLiveAudio = nextStream
                .getAudioTracks()
                .some(track => track.readyState === 'live');

            const hasLiveVideo = nextStream
                .getVideoTracks()
                .some(track => track.readyState === 'live');

            logDev('[SocialMobile] Remote stream updated', {
              callId,
              pcId,
              streamId: nextStream.id,
              streamUrl: nextStream.toURL?.(),
              hasLiveAudio,
              hasLiveVideo,
              tracks: summarizeStreamTracks(nextStream),
            });

            const mediaReady =
                callTypeRef.current === 'audio'
                    ? hasLiveAudio
                    : hasLiveVideo;

            if (
                mediaReady &&
                statusRef.current !== 'active' &&
                statusRef.current !== 'ended' &&
                statusRef.current !== 'error' &&
                statusRef.current !== 'idle'
            ) {
              setCallStatus('active', 'remote_media_ready');
            }
          };

            const ensureRemoteStreamForTrack = (track: MediaStreamTrack) => {
                const existing = remoteStreamRef.current;
                if (existing) {
                    if (!existing.getTrackById(track.id)) {
                        existing.addTrack(track);
                    }
                    return existing;
                }

                return new WebRTCMediaStream([track]) as MediaStream;
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
                    logPeerState(pc, callId, 'icecandidate:end', pcId);
                    return;
                }

                try {
                    const payload = candidate.toJSON();
                    console.log('[SocialMobile] ICE candidate raw', payload.candidate);
                    console.log('[SocialMobile] ICE candidate type', iceCandidateType(payload));
                    if (!isUsableIceCandidate(payload)) {
                        logDev('[SocialMobile] Skipping empty outgoing ICE candidate', {
                            callId,
                            pcId,
                        });
                        return;
                    }

                    logDev('[SocialMobile] Sending ICE candidate', {
                        callId,
                        pcId,
                        toId,
                        type: iceCandidateType(payload),
                        sdpMid: payload.sdpMid,
                        sdpMLineIndex: payload.sdpMLineIndex,
                    });
                    sendOrBufferOutgoingIce(toId, payload, callId);
                } catch (sendError) {
                    warnDev('[SocialMobile] Failed to send ICE candidate', sendError);
                }
            };

            const handleTrack = (event: unknown) => {
                if (!isCurrentConnection()) {
                    return;
                }

                const track = (event as { track?: MediaStreamTrack | null }).track;
                const [stream] = (event as { streams?: MediaStream[] }).streams ?? [];
                logDev('[SocialMobile] Remote track event', {
                    callId,
                    pcId,
                    trackKind: track?.kind,
                    track: track ? summarizeTrack(track) : null,
                    streamCount:
                        (event as { streams?: MediaStream[] }).streams?.length ?? 0,
                    streams:
                        (event as { streams?: MediaStream[] }).streams?.map(
                            summarizeStreamTracks,
                        ) ?? [],
                });

                if (stream) {
                    updateRemoteStream(stream);
                } else if (track) {
                    updateRemoteStream(ensureRemoteStreamForTrack(track));
                }
            };

            const handlePeerStateChange = (eventName: string) => {
                if (!isCurrentConnection()) {
                    return;
                }

                logPeerState(pc, callId, eventName, pcId);

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
                    if (callTypeRef.current === 'video') {
                        applyLocalVideoProfile(videoQualityProfiles.low).catch(
                            () => undefined,
                        );
                    }
                    const restartIce = (
                        pc as PeerConnection & { restartIce?: () => void }
                    ).restartIce;
                    if (iceRecoveryAttemptsRef.current < maxIceRecoveryAttempts) {
                        iceRecoveryAttemptsRef.current += 1;
                        try {
                            restartIce?.call(pc);
                            logDev('[SocialMobile] ICE restart requested', {
                                callId,
                                pcId,
                                attempt: iceRecoveryAttemptsRef.current,
                            });
                        } catch (restartError) {
                            warnDev('[SocialMobile] ICE restart failed', {
                                callId,
                                pcId,
                                restartError,
                            });
                        }
                    }

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
                            (
                                pc as PeerConnection & { restartIce?: () => void }
                            ).restartIce?.();
                            logDev('[SocialMobile] ICE restart requested after failure', {
                                callId,
                                pcId,
                                attempt: iceRecoveryAttemptsRef.current,
                            });
                            return;
                        } catch (restartError) {
                            warnDev('[SocialMobile] ICE restart after failure failed', {
                                callId,
                                pcId,
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
                logPeerState(pc, callId, 'icegatheringstatechange', pcId);
            const handleSignalingStateChange = () =>
                logPeerState(pc, callId, 'signalingstatechange', pcId);

            pcRef.current = pc;
            pcCallIdRef.current = callId;
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
        [
            clearDisconnectTimer,
            closePeerConnection,
            applyLocalVideoProfile,
            finishCall,
            getPeerConnectionId,
            sendOrBufferOutgoingIce,
            setCallStatus,
        ],
    );

    const startCall = useCallback(
        async (toId: number, name: string | undefined, nextCallType: CallType) => {
            if (
                !user?.id ||
                statusRef.current !== 'idle' ||
                startInFlightRef.current
            ) {
                logDev('[SocialMobile] Ignoring duplicate or invalid call start', {
                    toId,
                    callType: nextCallType,
                    status: statusRef.current,
                    startInFlight: startInFlightRef.current,
                });
                return;
            }

            startInFlightRef.current = true;
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
                            localVideoProfileRef.current = null;
                            setLocalStream(null);
                        }
                    }
                };

                chatSocket.connect();
                const {stream, callType: effectiveCallType} =
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
                const pcId = getPeerConnectionId(pc);

                logDev('[SocialMobile] Adding local tracks before createOffer', {
                    callId,
                    pcId,
                    tracks: summarizeStreamTracks(stream),
                });
                stream.getTracks().forEach(track => {
                    logDev('[SocialMobile] addTrack(local)', {
                        callId,
                        pcId,
                        track: summarizeTrack(track),
                    });
                    pc.addTrack(track, stream);
                });
                await applyVideoSenderQuality(
                    pc,
                    localVideoProfileRef.current,
                    callId,
                    pcId,
                );

                const offer = sessionDescriptionForSignal(
                    (await pc.createOffer()) as CallSessionDescription,
                );
                if (!isCurrentStart()) {
                    cleanupStaleStart(stream, pc);
                    return;
                }
                const offerSummary = summarizeSdp(offer.sdp);
                logDev('[SocialMobile] createOffer SDP summary', {
                    callId,
                    pcId,
                    callType: effectiveCallType,
                    summary: offerSummary,
                });
                warnIfOfferSdpNotBidirectional(
                    offerSummary,
                    effectiveCallType,
                    callId,
                    pcId,
                );

                await pc.setLocalDescription(new RTCSessionDescription(offer));
                if (!isCurrentStart()) {
                    cleanupStaleStart(stream, pc);
                    return;
                }
                const localOffer = sessionDescriptionForSignal(
                    pc.localDescription,
                    offer,
                );
                localOfferPeerRef.current = {
                    callId,
                    pcId: pcId ?? -1,
                };
                logDev('[SocialMobile] setLocalDescription(offer) complete', {
                    callId,
                    pcId,
                    signalingState: pc.signalingState,
                    localDescription: summarizeSdp(localOffer.sdp),
                });

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
                    pcId,
                    toId,
                    callType: effectiveCallType,
                    sdp: summarizeSdp(localOffer.sdp),
                });
                const offerSent = chatSocket.sendCallOffer(
                    toId,
                    localOffer,
                    effectiveCallType,
                    callId,
                );
                if (!offerSent) {
                    throw new Error('WebSocket is not connected');
                }
                markCallSignalingReady(callId, toId);
                setCallStatus('ringing', 'offer_sent');
            } catch (callError) {
                const message = callErrorMessage(callError);
                showCallError(message);
                finishCall('error', message);
            } finally {
                startInFlightRef.current = false;
            }
        },
        [
            clearEndTimer,
            closePeerConnection,
            createPeerConnection,
            finishCall,
            getPeerConnectionId,
            markCallSignalingReady,
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
            logDev('[SocialMobile] Ignoring duplicate call accept', {
                callId: callIdRef.current ?? pendingOfferRef.current?.callId,
                status: statusRef.current,
            });
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
                    localVideoProfileRef.current = null;
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
            cancelIncomingCallNotification(pendingOffer.callId).catch(
                () => undefined,
            );
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
            const pcId = getPeerConnectionId(pc);
            const activeStream = stream;
            const activePc = pc;
            logDev('[SocialMobile] Adding local tracks before createAnswer', {
                callId: pendingOffer.callId,
                pcId,
                tracks: summarizeStreamTracks(activeStream),
            });
            activeStream.getTracks().forEach(track => {
                logDev('[SocialMobile] addTrack(local)', {
                    callId: pendingOffer.callId,
                    pcId,
                    track: summarizeTrack(track),
                });
                activePc.addTrack(track, activeStream);
            });
            await applyVideoSenderQuality(
                activePc,
                localVideoProfileRef.current,
                pendingOffer.callId,
                pcId,
            );

            logDev('[SocialMobile] setRemoteDescription(offer) start', {
                callId: pendingOffer.callId,
                pcId,
                remoteDescription: summarizeSdp(pendingOffer.offer.sdp),
            });
            await activePc.setRemoteDescription(
                new RTCSessionDescription(pendingOffer.offer),
            );
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }
            logPeerState(activePc, pendingOffer.callId, 'remote-offer-set', pcId);
            await flushPendingIce();
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }

            const answer = sessionDescriptionForSignal(
                (await activePc.createAnswer()) as CallSessionDescription,
            );
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }
            logDev('[SocialMobile] createAnswer SDP summary', {
                callId: pendingOffer.callId,
                pcId,
                callType: opened.callType,
                summary: summarizeSdp(answer.sdp),
            });
            await activePc.setLocalDescription(new RTCSessionDescription(answer));
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }
            const localAnswer = sessionDescriptionForSignal(
                activePc.localDescription,
                answer,
            );
            logDev('[SocialMobile] setLocalDescription(answer) complete', {
                callId: pendingOffer.callId,
                pcId,
                signalingState: activePc.signalingState,
                localDescription: summarizeSdp(localAnswer.sdp),
            });
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
                pcId,
                toId: pendingOffer.fromId,
                callType: opened.callType,
                sdp: summarizeSdp(localAnswer.sdp),
            });
            const answerSent = chatSocket.sendCallAnswer(
                pendingOffer.fromId,
                localAnswer,
                pendingOffer.callId,
            );
            if (!answerSent) {
                throw new Error('WebSocket is not connected');
            }
            markCallSignalingReady(pendingOffer.callId, pendingOffer.fromId);
            pendingOfferRef.current = null;
            logDev('[SocialMobile] Call answer sent; waiting for media connection', {
                callId: pendingOffer.callId,
                pcId,
            });
        } catch (callError) {
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }
            sendTerminalCallAction(
                'reject',
                pendingOffer.fromId,
                pendingOffer.callId,
            );
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
        getPeerConnectionId,
        hydrateIncomingCall,
        markCallSignalingReady,
        openLocalStreamWithFallback,
        sendTerminalCallAction,
        setCurrentCallType,
        setCallStatus,
        user?.id,
    ]);

    const rejectCall = useCallback(() => {
        const targetId = peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
        const callId = callIdRef.current ?? pendingOfferRef.current?.callId;
        if (targetId && callId) {
            sendTerminalCallAction('reject', targetId, callId);
        }
        finishCall('ended');
    }, [finishCall, sendTerminalCallAction]);

    const endCall = useCallback(() => {
        const targetId = peerUserIdRef.current;
        const callId = callIdRef.current;
        if (targetId && callId) {
            sendTerminalCallAction('end', targetId, callId);
        }
        finishCall('ended');
    }, [finishCall, sendTerminalCallAction]);

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
        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        if (!videoTrack) {
            return;
        }

        videoTrack._switchCamera();
        applyVideoSenderQuality(
            pcRef.current,
            localVideoProfileRef.current,
            callIdRef.current,
            getPeerConnectionId(pcRef.current),
        ).catch(() => undefined);
        setFrontCamera(current => !current);
    }, [getPeerConnectionId]);

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
                        loadPeerName(fromId, matchingPushCall?.callerName, callId).catch(
                            () => undefined,
                        );
                        return;
                    }

                    sendTerminalCallAction('reject', fromId, callId);
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
                loadPeerName(fromId, matchingPushCall?.callerName, callId).catch(
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
                if (
                    isCallId(payload.call_id) &&
                    (event.type === WS_EVENTS.CALL_END ||
                        event.type === WS_EVENTS.CALL_REJECT ||
                        event.type === WS_EVENTS.CALL_TIMEOUT ||
                        event.type === WS_EVENTS.CALL_BUSY ||
                        event.type === WS_EVENTS.CALL_REPLACED)
                ) {
                    rememberTerminalIncomingCall(payload.call_id).catch(() => undefined);
                    chatSocket.discardPendingCallEvents(payload.call_id);
                }
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
                    warnDev('[SocialMobile] Call answer ignored without active PC', {
                        callId: payload.call_id,
                        fromId: payload.from_id,
                        hasAnswer: Boolean(payload.answer),
                    });
                    return;
                }
                const pcId = getPeerConnectionId(pc);
                const offerPeer = localOfferPeerRef.current;
                if (pcCallIdRef.current !== payload.call_id) {
                    warnDev('[SocialMobile] Call answer ignored for non-current PC', {
                        callId: payload.call_id,
                        pcCallId: pcCallIdRef.current,
                        pcId,
                    });
                    return;
                }
                if (
                    offerPeer?.callId === payload.call_id &&
                    offerPeer.pcId !== (pcId ?? -1)
                ) {
                    warnDev(
                        '[SocialMobile] Call answer ignored because offer PC changed',
                        {
                            callId: payload.call_id,
                            offerPcId: offerPeer.pcId,
                            currentPcId: pcId,
                        },
                    );
                    return;
                }

                logDev('[SocialMobile] Call answer received', {
                    callId: payload.call_id,
                    pcId,
                    fromId: payload.from_id,
                    answer: summarizeSdp(payload.answer.sdp),
                });
                const callId = payload.call_id;
                logDev('[SocialMobile] setRemoteDescription(answer) start', {
                    callId,
                    pcId,
                    signalingState: pc.signalingState,
                    remoteDescription: summarizeSdp(payload.answer.sdp),
                });
                pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
                    .then(async () => {
                        if (pcRef.current !== pc || callIdRef.current !== callId) {
                            return;
                        }
                        logPeerState(pc, callId, 'remote-answer-set', pcId);
                        await flushPendingIce();
                        if (pcRef.current !== pc || callIdRef.current !== callId) {
                            return;
                        }
                        if (statusRef.current !== 'active') {
                            setCallStatus('connecting', 'answer_set_waiting_for_media');
                        }
                    })
                    .catch(callError => {
                        if (pcRef.current !== pc || callIdRef.current !== callId) {
                            return;
                        }
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
                        pcId: getPeerConnectionId(pcRef.current),
                        fromId: payload.from_id,
                    });
                    return;
                }

                const remoteCandidate = withIceCandidateFromId(
                    candidate,
                    payload.from_id,
                );
                const candidateKey = iceCandidateDedupKey(
                    remoteCandidate,
                    payload.from_id,
                );
                if (appliedRemoteIceKeysRef.current.has(candidateKey)) {
                    logDev('[SocialMobile] Duplicate incoming ICE candidate ignored', {
                        callId: payload.call_id,
                        pcId: getPeerConnectionId(pcRef.current),
                        fromId: payload.from_id,
                        type: iceCandidateType(remoteCandidate),
                    });
                    return;
                }

                const pc = pcRef.current;
                const pcId = getPeerConnectionId(pc);
                if (pc && pcCallIdRef.current !== payload.call_id) {
                    warnDev('[SocialMobile] Incoming ICE ignored for non-current PC', {
                        callId: payload.call_id,
                        pcCallId: pcCallIdRef.current,
                        pcId,
                        fromId: payload.from_id,
                        type: iceCandidateType(candidate),
                    });
                    return;
                }
                if (!pc?.remoteDescription) {
                    queuePendingIceCandidate(remoteCandidate, payload.from_id, 'live');
                    return;
                }

                addIceCandidateSafely(pc, remoteCandidate, 'live', {
                    callId: payload.call_id,
                    pcId,
                    fromId: payload.from_id,
                })
                    .then(added => {
                        if (added) {
                            appliedRemoteIceKeysRef.current.add(candidateKey);
                        }
                    })
                    .catch(() => undefined);
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
                event.type === WS_EVENTS.CALL_REJECT ||
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
            getPeerConnectionId,
            loadPeerName,
            queuePendingIceCandidate,
            sendTerminalCallAction,
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
                logDev('[SocialMobile] WebSocket connected; restoring active call', {
                    callId: callIdRef.current,
                    pcId: getPeerConnectionId(pcRef.current),
                    status: statusRef.current,
                });
                hydrateIncomingCall().catch(() => undefined);
            }
        });
    }, [getPeerConnectionId, hydrateIncomingCall, user?.id]);

    useEffect(() => {
        if (status !== 'active' && status !== 'reconnecting') {
            return undefined;
        }

        const sendHeartbeat = () => {
            const targetId = peerUserIdRef.current;
            const callId = callIdRef.current;
            if (targetId && callId) {
                chatSocket.sendCallHeartbeat(targetId, callId);
            }
        };

        sendHeartbeat();
        const heartbeatTimer = setInterval(sendHeartbeat, callHeartbeatIntervalMs);
        return () => clearInterval(heartbeatTimer);
    }, [status]);

    useEffect(() => {
        if (
            status !== 'active' ||
            callType !== 'video' ||
            appState !== 'active' ||
            !networkConnected ||
            (localVideoProfileRef.current &&
                isSameVideoProfile(
                    localVideoProfileRef.current,
                    videoQualityProfiles.high,
                ))
        ) {
            return undefined;
        }

        const upgradeTimer = setTimeout(() => {
            if (
                statusRef.current !== 'active' ||
                callTypeRef.current !== 'video' ||
                appState !== 'active' ||
                !networkConnectedRef.current ||
                (localVideoProfileRef.current &&
                    isSameVideoProfile(
                        localVideoProfileRef.current,
                        videoQualityProfiles.high,
                    ))
            ) {
                return;
            }

            initialVideoQualityProfile(networkConnectedRef.current)
                .then(async profile => {
                    for (const fallbackProfile of videoProfileFallbackChain(profile)) {
                        if (fallbackProfile.name === 'low') {
                            return;
                        }
                        const applied = await applyLocalVideoProfile(fallbackProfile);
                        if (applied) {
                            return;
                        }
                    }
                })
                .catch(() => undefined);
        }, 20000);

        return () => clearTimeout(upgradeTimer);
    }, [appState, applyLocalVideoProfile, callType, networkConnected, status]);

    useEffect(() => {
        if (
            (status !== 'active' && status !== 'reconnecting') ||
            callType !== 'video' ||
            networkConnected
        ) {
            return;
        }

        applyLocalVideoProfile(videoQualityProfiles.low).catch(() => undefined);
    }, [applyLocalVideoProfile, callType, networkConnected, status]);

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
                frontCamera={frontCamera}
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
                       frontCamera,
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
  frontCamera: boolean;
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

  const isVideoCall = callType === 'video';

  const remoteVideoTrack = remoteStream
      ?.getVideoTracks()
      .find(track => track.readyState === 'live');

  const localVideoTrack = localStream
      ?.getVideoTracks()
      .find(track => track.readyState === 'live');

  const remoteStreamUrl = remoteStream?.toURL?.();
  const localStreamUrl = localStream?.toURL?.();

  const showRemoteVideo = Boolean(
      isVideoCall &&
      remoteStream &&
      remoteStreamUrl &&
      remoteVideoTrack,
  );

  const showVideoPlaceholder = Boolean(
      isVideoCall &&
      !remoteVideoTrack,
  );

  const showLocalPreview = Boolean(
      isVideoCall &&
      localStream &&
      localStreamUrl &&
      localVideoTrack,
  );

  const showActiveControls =
      status === 'connecting' ||
      status === 'ringing' ||
      status === 'active' ||
      status === 'reconnecting';

  const initial = peerName.slice(0, 1).toUpperCase();

  const showSpinner =
      status === 'connecting' ||
      status === 'ringing' ||
      status === 'reconnecting';

  return (
      <Modal
          visible
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent
          navigationBarTranslucent
      >
        <StatusBar hidden animated />

        <View style={styles.callRoot}>
          <View style={styles.remoteStage}>
            {showRemoteVideo && remoteStreamUrl ? (
                <RTCView
                    key={remoteStreamUrl}
                    streamURL={remoteStreamUrl}
                    style={styles.remoteVideo}
                    objectFit="cover"
                    zOrder={0}
                />
            ) : null}

            {showVideoPlaceholder ? (
                <View style={styles.videoPlaceholder}>
                  <Text style={styles.videoPlaceholderText}>
                    Ожидание видео
                  </Text>

                  {showSpinner ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                  ) : null}
                </View>
            ) : null}

            {!isVideoCall ? (
                <View style={styles.audioStage}>
                  <View style={styles.avatarPulse} />

                  <View style={styles.peerAvatar}>
                    <Text style={styles.peerInitial}>{initial}</Text>
                  </View>

                  {showSpinner ? (
                      <ActivityIndicator color="#ffffff" size="large" />
                  ) : null}
                </View>
            ) : null}
          </View>

          <View
              style={[
                styles.callHeader,
                { top: Math.max(insets.top, 12) + 12 },
              ]}
          >
            <Text style={styles.callName} numberOfLines={1}>
              {peerName}
            </Text>

            <Text style={styles.callStatus}>
              {error ?? statusText(status, callType)}
            </Text>
          </View>

          {showLocalPreview && localStreamUrl ? (
              <View
                  style={[
                    styles.localPreview,
                    { top: Math.max(insets.top, 12) + 86 },
                  ]}
              >
                <RTCView
                    key={localStreamUrl}
                    streamURL={localStreamUrl}
                    style={styles.localVideo}
                    mirror={frontCamera}
                    objectFit="cover"
                    zOrder={1}
                />
              </View>
          ) : null}

          <View
              style={[
                styles.callControls,
                { bottom: Math.max(insets.bottom, 10) + 10 },
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

                  <CallButton
                      label="Завершить"
                      icon={PhoneOff}
                      danger
                      onPress={onEnd}
                  />
                </View>
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
                style={({pressed}) => [
                    styles.callButton,
                    large && styles.callButtonLarge,
                    danger && styles.callButtonDanger,
                    accept && styles.callButtonAccept,
                    muted && styles.callButtonMuted,
                    pressed && styles.callButtonPressed,
                ]}
                onPress={onPress}
            >
                <Icon color={iconColor} size={large ? 30 : 23} strokeWidth={2.5}/>
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
        backgroundColor: '#020617',
        overflow: 'hidden',
    },
    remoteStage: {
        ...absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#020617',
    },
    remoteVideo: {
        ...absoluteFillObject,
    },
    videoPlaceholder: {
        ...absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        backgroundColor: '#020617',
    },
    videoPlaceholderText: {
        color: '#f8fafc',
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '800',
        textAlign: 'center',
    },
    audioStage: {
        ...absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        backgroundColor: '#020617',
    },
    avatarPulse: {
        position: 'absolute',
        width: 190,
        height: 190,
        borderRadius: 95,
        backgroundColor: 'rgba(14, 165, 233, 0.14)',
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
        shadowOffset: {width: 0, height: 16},
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
        zIndex: 30,
        elevation: 30,
        left: 24,
        right: 24,
        alignItems: 'center',
        gap: 7,
    },
    callName: {
        color: '#ffffff',
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '900',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: {width: 0, height: 1},
        textShadowRadius: 8,
    },
    callStatus: {
        color: 'rgba(255,255,255,0.82)',
        fontSize: 15,
        lineHeight: 20,
        fontWeight: '600',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: {width: 0, height: 1},
        textShadowRadius: 6,
    },
    localPreview: {
        position: 'absolute',
        right: 16,
        width: 112,
        height: 160,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.86)',
        borderRadius: 18,
        backgroundColor: '#0f172a',
        shadowColor: '#000000',
        shadowOpacity: 0.32,
        shadowRadius: 18,
        shadowOffset: {width: 0, height: 10},
        zIndex: 25,
        elevation: 25,
    },
    localVideo: {
        ...absoluteFillObject,
        borderRadius: 18,
    },
    callControls: {
        position: 'absolute',
        left: 14,
        right: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 24,
        backgroundColor: 'rgba(15,23,42,0.74)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        shadowColor: '#000000',
        shadowOpacity: 0.3,
        shadowRadius: 18,
        shadowOffset: {width: 0, height: 8},
        zIndex: 35,
        elevation: 35,
    },
    incomingControlsRow: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
    },
    callButtonsRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-evenly',
        gap: 10,
    },
    callButtonWrap: {
        alignItems: 'center',
        gap: 6,
        minWidth: 64,
    },
    callButton: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(15,23,42,0.08)',
    },
    callButtonLarge: {
        width: 66,
        height: 66,
        borderRadius: 33,
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
        transform: [{scale: 0.96}],
    },
    callButtonText: {
        color: '#ffffff',
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '800',
        textAlign: 'center',
    },
});
