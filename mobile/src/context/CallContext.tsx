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
    Alert,
    NativeModules,
    PermissionsAndroid,
    Platform,
} from 'react-native';
import {
    MediaStream as WebRTCMediaStream,
    mediaDevices,
    RTCIceCandidate,
    RTCPeerConnection,
    RTCRtpSender,
    RTCSessionDescription,
    type MediaStream,
    type MediaStreamTrack,
} from 'react-native-webrtc';
import NetInfo from '@react-native-community/netinfo';
import { WS_EVENTS } from '@social/shared';

import {
    callsApi,
    type ActiveCall,
    type RestoredCallIceCandidate,
} from '../api/calls';
import { userApi } from '../api/users';
import {
    chatSocket,
    type CallIceCandidate,
    type CallSessionDescription,
    type CallType,
    type WsEvent,
} from '../api/ws';
import {
    TURN_CREDENTIAL,
    TURN_URLS,
    TURN_USERNAME,
    WEBRTC_FORCE_RELAY,
} from '../config/env';
import {
    callError as logCallError,
    callLog,
    callWarn,
    describeCallError,
    logCallEnvOnce,
} from '../utils/callDiagnostics';
import { useAppLifecycle } from './AppLifecycleContext';
import { useAuth } from './AuthContext';
import {
    clearPendingIncomingCall,
    consumePendingIncomingCall,
    rememberTerminalIncomingCall,
    subscribePendingIncomingCall,
    type PendingIncomingCallPush,
} from '../notifications/pendingIncomingCall';
import { cancelIncomingCallNotification } from '../notifications/localNotifications';
import { logDev, warnDev } from '../utils/logger';
import {
    collectWebRTCDiagnostics,
    createCallStatsAccumulator,
    type WebRTCDiagnosticsSnapshot,
} from '../utils/webrtcStats';
import { registerCallShutdownHandler } from './callLifecycle';
import {
    isLiveServerCall,
    isTerminalCallStatus,
    shouldKeepLocalServerCall,
    shouldShowIncomingServerCall,
} from './callSync';
import { CallOverlay } from './CallOverlay';

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
    setCallActive: (speakerphoneOn: boolean) => void;
    setSpeakerphoneOn?: (speakerphoneOn: boolean) => void;
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
    audioCodecs: string[];
    preferredAudioCodec: string | null;
    videoCodecs: string[];
    preferredVideoCodec: string | null;
    hasOpus: boolean;
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
type AudioQualityProfileName = 'low' | 'medium' | 'high';
type AudioQualityProfile = {
    name: AudioQualityProfileName;
    maxBitrate: number;
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
const callStatsIntervalMs = 4000;
const maxIceRecoveryAttempts = 2;
const callAudioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    googEchoCancellation: true,
    googNoiseSuppression: true,
    googAutoGainControl: true,
    googHighpassFilter: true,
} as unknown as CallMediaConstraints['audio'];
const audioQualityProfiles = {
    low: {
        name: 'low',
        maxBitrate: 24000,
    },
    medium: {
        name: 'medium',
        maxBitrate: 40000,
    },
    high: {
        name: 'high',
        maxBitrate: 64000,
    },
} satisfies Record<AudioQualityProfileName, AudioQualityProfile>;
const videoQualityProfiles = {
    low: {
        name: 'low',
        width: 640,
        height: 360,
        frameRate: 20,
        sender: { maxBitrate: 650000, maxFramerate: 20 },
    },
    medium: {
        name: 'medium',
        width: 960,
        height: 540,
        frameRate: 24,
        sender: { maxBitrate: 1400000, maxFramerate: 24 },
    },
    high: {
        name: 'high',
        width: 1280,
        height: 720,
        frameRate: 30,
        sender: { maxBitrate: 2200000, maxFramerate: 30 },
    },
} satisfies Record<VideoQualityProfileName, VideoQualityProfile>;
const highFallbackProfile: VideoQualityProfile = {
    name: 'high',
    width: 960,
    height: 540,
    frameRate: 24,
    sender: { maxBitrate: 1400000, maxFramerate: 24 },
};
const nativeCallAudioSession = (
    NativeModules as { CallAudioSession?: NativeCallAudioSession }
).CallAudioSession;

function setNativeCallSessionActive(active: boolean, speakerphoneOn = false) {
    if (Platform.OS !== 'android') {
        return;
    }

    try {
        if (active) {
            nativeCallAudioSession?.setCallActive(speakerphoneOn);
        } else {
            nativeCallAudioSession?.clearCallActive();
        }
    } catch (nativeError) {
        logCallError('CALL_ERROR', 'native call audio session update failed', {
            active,
            error: describeCallError(nativeError),
        });
        warnDev('[SocialMobile] Failed to update native call audio session', {
            active,
            error: nativeError,
        });
    }
}

function defaultSpeakerphoneForCallType(callType: CallType) {
    return callType === 'video';
}

function createCallId() {
    return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCallId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function normalizeCallUserId(value: unknown) {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string'
            ? Number(value)
            : NaN;

    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

let turnConfigAudited = false;

function parseTurnUrl(url: string) {
    const trimmed = url.trim();
    const schemeMatch = trimmed.match(/^(turns?):/i);
    if (!schemeMatch) {
        return null;
    }

    const scheme = schemeMatch[1].toLowerCase() as 'turn' | 'turns';
    const withoutScheme = trimmed.slice(scheme.length + 1);
    const [authority = '', query = ''] = withoutScheme.split('?');
    const hostPort = authority.replace(/^\/\//, '').split('/')[0] ?? '';
    const transport =
        query.match(/(?:^|&)transport=(udp|tcp)(?:&|$)/i)?.[1].toLowerCase() ??
        (scheme === 'turns' ? 'tcp' : 'udp');

    let host = hostPort;
    let port: number | null = null;
    if (hostPort.startsWith('[')) {
        const bracketIndex = hostPort.indexOf(']');
        host = bracketIndex >= 0 ? hostPort.slice(1, bracketIndex) : hostPort;
        const portText =
            bracketIndex >= 0 && hostPort[bracketIndex + 1] === ':'
                ? hostPort.slice(bracketIndex + 2)
                : '';
        port = portText ? Number(portText) : null;
    } else {
        const colonIndex = hostPort.lastIndexOf(':');
        const hasSingleColon =
            colonIndex > 0 && hostPort.indexOf(':') === colonIndex;
        if (hasSingleColon) {
            host = hostPort.slice(0, colonIndex);
            port = Number(hostPort.slice(colonIndex + 1));
        }
    }

    return {
        url: trimmed,
        scheme,
        transport,
        host,
        port: Number.isFinite(port) ? port : null,
    };
}

function turnConfigSummary(urls: string[]) {
    const turnUrls = urls.map(parseTurnUrl).filter(Boolean) as Array<
        NonNullable<ReturnType<typeof parseTurnUrl>>
    >;

    return {
        urlCount: urls.length,
        hasTurnUdp: turnUrls.some(
            url => url.scheme === 'turn' && url.transport === 'udp',
        ),
        hasTurnTcp: turnUrls.some(url => url.transport === 'tcp'),
        hasPlainTurnTcp: turnUrls.some(
            url => url.scheme === 'turn' && url.transport === 'tcp',
        ),
        hasTurnTcp443: turnUrls.some(
            url => url.transport === 'tcp' && url.port === 443,
        ),
        hasTurnsTls443: turnUrls.some(
            url =>
                url.scheme === 'turns' &&
                url.transport === 'tcp' &&
                url.port === 443,
        ),
        transports: Array.from(
            new Set(turnUrls.map(url => `${url.scheme}/${url.transport}`)),
        ),
        ports: Array.from(
            new Set(
                turnUrls
                    .map(url => url.port)
                    .filter((port): port is number => port !== null),
            ),
        ).sort((left, right) => left - right),
    };
}

function auditTurnConfiguration() {
    if (turnConfigAudited) {
        return;
    }
    turnConfigAudited = true;

    const summary = turnConfigSummary(TURN_URLS);
    callLog('CALL_ENV', 'TURN ICE config audit', {
        ...summary,
        hasUsername: Boolean(TURN_USERNAME),
        hasCredential: Boolean(TURN_CREDENTIAL),
    });

    if (TURN_URLS.length === 0) {
        callWarn('CALL_ENV', 'TURN is not configured for mobile calls', {
            recommendation:
                'Configure TURN for calls outside LAN/NAT-friendly networks.',
        });
        return;
    }

    if (!TURN_USERNAME || !TURN_CREDENTIAL) {
        callWarn('CALL_ENV', 'TURN URLs configured without username or credential', {
            turnUrls: TURN_URLS.length,
            hasUsername: Boolean(TURN_USERNAME),
            hasCredential: Boolean(TURN_CREDENTIAL),
        });
    }

    if (
        !summary.hasTurnUdp ||
        !summary.hasPlainTurnTcp ||
        !summary.hasTurnTcp443
    ) {
        callWarn('CALL_ENV', 'TURN transport fallback is incomplete', {
            ...summary,
            recommendation:
                'Use UDP TURN plus TCP/TLS TURN on port 443 for restrictive mobile networks.',
        });
    }

    if (!summary.hasTurnsTls443) {
        callWarn('CALL_ENV', 'TURN TLS 443 URL is missing', {
            ...summary,
            recommendation:
                'Add a turns:host:443?transport=tcp URL when the TURN provider supports TLS.',
        });
    }

    callWarn('CALL_ENV', 'TURN server geography should be verified', {
        recommendation:
            'Place TURN close to the primary mobile audience or use a managed provider with regional POPs.',
    });
}

function iceServers() {
    auditTurnConfiguration();
    const servers: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
    }> = [{ urls: 'stun:stun.l.google.com:19302' }];

    if (TURN_URLS.length > 0) {
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

    return Platform.OS === 'android' && Number(Platform.Version) < 26
        ? highFallbackProfile
        : videoQualityProfiles.high;
}

async function initialAudioQualityProfile(networkConnected: boolean) {
    if (!networkConnected) {
        return audioQualityProfiles.low;
    }

    try {
        const state = await NetInfo.fetch();
        if (state.type === 'cellular') {
            const generation = state.details?.cellularGeneration;
            if (generation === '2g' || generation === '3g') {
                return audioQualityProfiles.low;
            }
            if (generation === '4g') {
                return audioQualityProfiles.medium;
            }
            return generation === '5g'
                ? audioQualityProfiles.high
                : audioQualityProfiles.medium;
        }
        if (state.type === 'wifi' || state.type === 'ethernet') {
            return audioQualityProfiles.high;
        }
    } catch {
        return audioQualityProfiles.medium;
    }

    return audioQualityProfiles.medium;
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

function videoConstraints(
    profile: VideoQualityProfile,
    facingMode: 'user' | 'environment' = 'user',
) {
    return {
        facingMode: { ideal: facingMode },
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        frameRate: { ideal: profile.frameRate, max: 30 },
    };
}

async function requestCallPermissions(callType: CallType) {
    if (Platform.OS !== 'android') {
        callLog('CALL_WEBRTC', 'call permissions skipped on non-android', {
            callType,
            platform: Platform.OS,
        });
        return true;
    }

    const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (callType === 'video') {
        permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    }

    try {
        callLog('CALL_WEBRTC', 'requesting call permissions', {
            callType,
            permissions,
        });
        const result = await PermissionsAndroid.requestMultiple(permissions);
        const denied = permissions.filter(
            permission =>
                result[permission] !== PermissionsAndroid.RESULTS.GRANTED,
        );

        if (denied.length > 0) {
            callWarn('CALL_ERROR', 'call permissions denied', {
                callType,
                denied,
            });
            warnDev('[SocialMobile] Call permissions denied', {
                callType,
                denied,
            });
            return false;
        }

        callLog('CALL_WEBRTC', 'call permissions granted', {
            callType,
            permissions,
        });
        return true;
    } catch (error) {
        logCallError('CALL_ERROR', 'failed to request call permissions', {
            callType,
            error: describeCallError(error),
        });
        warnDev('[SocialMobile] Failed to request call permissions', error);
        return false;
    }
}

function stopStream(stream: MediaStream | null) {
    stream?.getTracks().forEach(track => {
        try {
            track.stop();
        } catch (error) {
            logCallError('CALL_ERROR', 'failed to stop media track', {
                error: describeCallError(error),
            });
            warnDev('[SocialMobile] Failed to stop media track', error);
        }
    });

    try {
        stream?.release?.(true);
    } catch (error) {
        logCallError('CALL_ERROR', 'failed to release media stream', {
            error: describeCallError(error),
        });
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
    const diagnosticTrack = track as MediaStreamTrack & {
        getSettings?: () => Record<string, unknown>;
        getConstraints?: () => Record<string, unknown>;
    };
    return {
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        settings: diagnosticTrack.getSettings?.() ?? null,
        constraints: diagnosticTrack.getConstraints?.() ?? null,
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

function codecNames(section: string | undefined) {
    if (!section) {
        return [];
    }

    const codecs = new Set<string>();
    section.split(/\r?\n/).forEach(line => {
        const match = line.match(/^a=rtpmap:\d+\s+([^/\s]+)/i);
        if (match?.[1]) {
            codecs.add(match[1].toLowerCase());
        }
    });
    return Array.from(codecs);
}

function mergeFmtpParams(
    payloadId: string,
    line: string | undefined,
    additions: Record<string, string>,
) {
    const existing = line?.match(/^a=fmtp:(\d+)\s+(.+)$/i);
    const params = new Map<string, string>();

    existing?.[2]
        .split(';')
        .map(param => param.trim())
        .filter(Boolean)
        .forEach(param => {
            const [key, ...valueParts] = param.split('=');
            if (!key) {
                return;
            }
            params.set(key.toLowerCase(), valueParts.join('=') || '');
        });

    Object.entries(additions).forEach(([key, value]) => {
        params.set(key.toLowerCase(), value);
    });

    const fmtp = Array.from(params.entries())
        .map(([key, value]) => (value ? `${key}=${value}` : key))
        .join(';');

    return `a=fmtp:${existing?.[1] ?? payloadId} ${fmtp}`;
}

function preferOpusInSdp(sdp: string, audioProfile: AudioQualityProfile) {
    if (!sdp) {
        return sdp;
    }

    const lineBreak = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const audioLineIndex = lines.findIndex(line => line.startsWith('m=audio '));
    if (audioLineIndex < 0) {
        return sdp;
    }

    const opusPayloadIds = lines
        .map(line => line.match(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i)?.[1])
        .filter((payloadId): payloadId is string => Boolean(payloadId));

    if (opusPayloadIds.length === 0) {
        return sdp;
    }

    const audioLineParts = lines[audioLineIndex].split(' ');
    const header = audioLineParts.slice(0, 3);
    const payloads = audioLineParts.slice(3);
    const opusPayloadSet = new Set(opusPayloadIds);
    lines[audioLineIndex] = [
        ...header,
        ...opusPayloadIds,
        ...payloads.filter(payload => !opusPayloadSet.has(payload)),
    ].join(' ');

    opusPayloadIds.forEach(payloadId => {
        const fmtpIndex = lines.findIndex(line =>
            line.toLowerCase().startsWith(`a=fmtp:${payloadId} `),
        );
        const nextFmtp = mergeFmtpParams(
            payloadId,
            lines[fmtpIndex],
            {
                useinbandfec: '1',
                minptime: '10',
                maxaveragebitrate: String(audioProfile.maxBitrate),
            },
        );

        if (fmtpIndex >= 0) {
            lines[fmtpIndex] = nextFmtp;
            return;
        }

        const rtpmapIndex = lines.findIndex(line =>
            line.toLowerCase().startsWith(`a=rtpmap:${payloadId} `),
        );
        lines.splice(rtpmapIndex + 1, 0, nextFmtp);
    });

    return lines.join(lineBreak);
}

function preferOpusInSessionDescription(
    description: CallSessionDescription,
    audioProfile: AudioQualityProfile,
): CallSessionDescription {
    return {
        ...description,
        sdp: preferOpusInSdp(description.sdp, audioProfile),
    };
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
    const audioCodecs = codecNames(audioSection);
    const videoCodecs = codecNames(videoSection).filter(
        codec => !['rtx', 'red', 'ulpfec', 'flexfec-03'].includes(codec),
    );

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
        audioCodecs,
        preferredAudioCodec: audioCodecs[0] ?? null,
        videoCodecs,
        preferredVideoCodec: videoCodecs[0] ?? null,
        hasOpus: audioCodecs.includes('opus'),
        hasSendrecv:
            audioDirection === 'sendrecv' || videoDirection === 'sendrecv',
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
        callWarn('CALL_WEBRTC', 'mobile offer SDP is not bidirectional', {
            callId,
            pcId,
            callType,
            summary,
        });
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
        callLog('CALL_WEBRTC', 'skipping empty ICE candidate', {
            context,
            ...details,
        });
        logDev('[SocialMobile] Skipping empty ICE candidate', {
            context,
            ...details,
        });
        return false;
    }

    try {
        callLog('CALL_WEBRTC', 'adding ICE candidate', {
            context,
            ...details,
            type: iceCandidateType(candidate),
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
        });
        logDev('[SocialMobile] Adding ICE candidate', {
            context,
            ...details,
            type: iceCandidateType(candidate),
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
        });
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        if (context === 'restored') {
            callLog('CALL_WEBRTC', 'restored ICE candidate added', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
            logDev('[SocialMobile] addIceCandidate restored', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
        } else {
            callLog('CALL_WEBRTC', 'ICE candidate added', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
            logDev('[SocialMobile] ICE candidate added', {
                context,
                ...details,
                type: iceCandidateType(candidate),
            });
        }
        return true;
    } catch (error) {
        logCallError('CALL_ERROR', 'failed to add ICE candidate', {
            context,
            ...details,
            error: describeCallError(error),
            type: candidate ? iceCandidateType(candidate) : 'unknown',
        });
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
    callLog('CALL_WEBRTC', 'peer state changed', {
        callId,
        pcId,
        nativePcId: pc._pcId,
        event,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
    });
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
    callLog('CALL_WEBRTC', 'ICE config before peer connection', {
        callId,
        pcId,
        iceServers: servers.map(server => ({
            urls: server.urls,
            hasUsername: Boolean(server.username),
            usernameLen: server.username?.length ?? 0,
            hasCredential: Boolean(server.credential),
            credentialLen: server.credential?.length ?? 0,
        })),
    });
    logDev('[SocialMobile] ICE config before pc', {
        callId,
        pcId,
        iceServers: servers.map(server => ({
            urls: server.urls,
            hasUsername: Boolean(server.username),
            usernameLen: server.username?.length ?? 0,
            hasCredential: Boolean(server.credential),
            credentialLen: server.credential?.length ?? 0,
        })),
    });
}

async function videoSenderQualityForNetwork(
    networkConnected: boolean,
    captureProfile: VideoQualityProfile | null | undefined,
) {
    let networkProfile: VideoQualityProfile = videoQualityProfiles.medium;
    let networkClass = 'medium';

    if (!networkConnected) {
        networkProfile = videoQualityProfiles.low;
        networkClass = 'offline';
    } else {
        try {
            const state = await NetInfo.fetch();
            if (state.type === 'wifi' || state.type === 'ethernet') {
                networkProfile = videoQualityProfiles.high;
                networkClass = state.type;
            } else if (state.type === 'cellular') {
                const generation = state.details?.cellularGeneration;
                if (generation === '2g' || generation === '3g') {
                    networkProfile = videoQualityProfiles.low;
                    networkClass = generation;
                } else if (generation === '5g') {
                    networkProfile = videoQualityProfiles.high;
                    networkClass = '5g';
                } else {
                    networkProfile = videoQualityProfiles.medium;
                    networkClass = generation ?? 'cellular-unknown';
                }
            } else if (state.type === 'none' || state.type === 'unknown') {
                networkProfile = videoQualityProfiles.low;
                networkClass = state.type;
            }
        } catch {
            networkProfile = videoQualityProfiles.medium;
            networkClass = 'netinfo-unavailable';
        }
    }

    const capture = captureProfile ?? highFallbackProfile;
    const maxFramerate = Math.min(
        capture.frameRate,
        networkProfile.sender.maxFramerate,
    );
    return {
        networkClass,
        maxBitrate: networkProfile.sender.maxBitrate,
        maxFramerate,
        scaleResolutionDownBy: 1,
    };
}

async function applyVideoSenderQuality(
    pc: PeerConnection | null,
    profile: VideoQualityProfile | null | undefined,
    networkConnected: boolean,
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
        const senderQuality = await videoSenderQualityForNetwork(
            networkConnected,
            profile,
        );
        const parameters = sender.getParameters();
        const before = {
            degradationPreference: parameters.degradationPreference,
            encodings: parameters.encodings.map(encoding => ({
                active: encoding.active,
                maxBitrate: encoding.maxBitrate,
                maxFramerate: encoding.maxFramerate,
                scaleResolutionDownBy: encoding.scaleResolutionDownBy,
            })),
        };
        parameters.degradationPreference = 'balanced';
        if (parameters.encodings.length === 0) {
            parameters.encodings = [
                {
                    active: true,
                    maxBitrate: senderQuality.maxBitrate,
                    maxFramerate: senderQuality.maxFramerate,
                    scaleResolutionDownBy: senderQuality.scaleResolutionDownBy,
                },
            ];
        } else {
            parameters.encodings.forEach(encoding => {
                encoding.active = true;
                encoding.maxBitrate = senderQuality.maxBitrate;
                encoding.maxFramerate = senderQuality.maxFramerate;
                encoding.scaleResolutionDownBy =
                    senderQuality.scaleResolutionDownBy;
            });
        }
        await sender.setParameters(parameters);
        const applied = sender.getParameters();
        const appliedParameters = {
            degradationPreference: applied.degradationPreference,
            encodings: applied.encodings.map(encoding => ({
                active: encoding.active,
                maxBitrate: encoding.maxBitrate,
                maxFramerate: encoding.maxFramerate,
                scaleResolutionDownBy: encoding.scaleResolutionDownBy,
            })),
        };
        callLog('CALL_WEBRTC', 'video sender quality applied', {
            callId,
            pcId,
            captureProfile: profile?.name ?? null,
            before,
            appliedParameters,
            ...senderQuality,
        });
        logDev('[SocialMobile] Video sender quality applied', {
            callId,
            pcId,
            captureProfile: profile?.name ?? null,
            before,
            appliedParameters,
            ...senderQuality,
        });
    } catch (qualityError) {
        logCallError('CALL_ERROR', 'failed to apply video sender quality', {
            callId,
            pcId,
            error: describeCallError(qualityError),
        });
        warnDev('[SocialMobile] Failed to apply video sender quality', {
            callId,
            pcId,
            error: qualityError,
        });
    }
}

type VideoCodecCapability = {
    mimeType?: string;
    sdpFmtpLine?: string;
    payloadType?: number;
    [key: string]: unknown;
};

function videoCodecPriority(codec: VideoCodecCapability) {
    switch ((codec.mimeType ?? '').toLowerCase()) {
        case 'video/h264':
            return 0;
        case 'video/vp8':
            return 1;
        case 'video/vp9':
            return 2;
        case 'video/av1':
        case 'video/av1x':
            return 3;
        case 'video/rtx':
        case 'video/red':
        case 'video/ulpfec':
        case 'video/flexfec-03':
            return 10;
        default:
            return 5;
    }
}

function applyVideoCodecPreferences(
    pc: PeerConnection,
    callId: string,
    pcId: number | null,
) {
    try {
        const transceiver = pc
            .getTransceivers()
            .find(item => item.sender.track?.kind === 'video');
        if (!transceiver?.setCodecPreferences) {
            callWarn('CALL_WEBRTC', 'video codec preferences unavailable', {
                callId,
                pcId,
                hasVideoTransceiver: Boolean(transceiver),
            });
            return;
        }

        const capabilities = RTCRtpSender.getCapabilities('video') as unknown as {
            codecs?: VideoCodecCapability[];
        };
        const codecs = [...(capabilities?.codecs ?? [])];
        if (codecs.length === 0) {
            callWarn('CALL_WEBRTC', 'video codec capabilities are empty', {
                callId,
                pcId,
            });
            return;
        }

        const ordered = codecs
            .map((codec, index) => ({ codec, index }))
            .sort(
                (left, right) =>
                    videoCodecPriority(left.codec) -
                        videoCodecPriority(right.codec) ||
                    left.index - right.index,
            )
            .map(item => item.codec);

        transceiver.setCodecPreferences(ordered as never[]);
        callLog('CALL_WEBRTC', 'video codec preferences applied', {
            callId,
            pcId,
            codecs: ordered.map(codec => ({
                mimeType: codec.mimeType ?? null,
                payloadType: codec.payloadType ?? null,
                sdpFmtpLine: codec.sdpFmtpLine ?? null,
            })),
        });
        logDev('[SocialMobile] Video codec preferences applied', {
            callId,
            pcId,
            order: ordered.map(codec => codec.mimeType ?? 'unknown'),
        });
    } catch (codecError) {
        logCallError('CALL_ERROR', 'failed to apply video codec preferences', {
            callId,
            pcId,
            error: describeCallError(codecError),
        });
    }
}

async function applyAudioSenderQuality(
    pc: PeerConnection | null,
    networkConnected: boolean,
    callId?: string | null,
    pcId?: number | null,
) {
    if (!pc) {
        return;
    }

    const sender = pc.getSenders().find(item => item.track?.kind === 'audio');
    if (!sender) {
        return;
    }

    try {
        const audioProfile = await initialAudioQualityProfile(networkConnected);
        const parameters = sender.getParameters();
        if (parameters.encodings.length === 0) {
            parameters.encodings = [
                {
                    active: true,
                    maxBitrate: audioProfile.maxBitrate,
                },
            ];
        } else {
            parameters.encodings.forEach(encoding => {
                encoding.maxBitrate = audioProfile.maxBitrate;
            });
        }
        await sender.setParameters(parameters);
        callLog('CALL_WEBRTC', 'audio sender quality applied', {
            callId,
            pcId,
            profile: audioProfile.name,
            maxBitrate: audioProfile.maxBitrate,
        });
        logDev('[SocialMobile] Audio sender quality applied', {
            callId,
            pcId,
            profile: audioProfile.name,
            maxBitrate: audioProfile.maxBitrate,
        });
    } catch (qualityError) {
        logCallError('CALL_ERROR', 'failed to apply audio sender quality', {
            callId,
            pcId,
            error: describeCallError(qualityError),
        });
        warnDev('[SocialMobile] Failed to apply audio sender quality', {
            callId,
            pcId,
            error: qualityError,
        });
    }
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

export function CallProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { appState, networkConnected, resumeCount } = useAppLifecycle();
    const [status, setStatus] = useState<CallStatus>('idle');
    const [callType, setCallType] = useState<CallType>('audio');
    const [peerUserId, setPeerUserId] = useState<number | null>(null);
    const [peerName, setPeerName] = useState('Пользователь');
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [microphoneOn, setMicrophoneOn] = useState(true);
    const [cameraOn, setCameraOn] = useState(true);
    const [speakerphoneOn, setSpeakerphoneOn] = useState(false);
    const [frontCamera, setFrontCamera] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] =
        useState<WebRTCDiagnosticsSnapshot | null>(null);

    const statusRef = useRef(status);
    const peerUserIdRef = useRef(peerUserId);
    const callTypeRef = useRef(callType);
    const speakerphoneOnRef = useRef(speakerphoneOn);
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
    const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const callStatsTimerRef = useRef<ReturnType<typeof setInterval> | null>(
        null,
    );
    const callStatsAccumulatorRef = useRef(createCallStatsAccumulator());
    const iceRestartInFlightRef = useRef(false);
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
        speakerphoneOnRef.current = speakerphoneOn;
    }, [speakerphoneOn]);

    useEffect(() => {
        networkConnectedRef.current = networkConnected;
    }, [networkConnected]);

    const callSessionActive =
        status !== 'idle' && status !== 'ended' && status !== 'error';

    useEffect(() => {
        setNativeCallSessionActive(callSessionActive, speakerphoneOn);
    }, [appState, callSessionActive, speakerphoneOn, status]);

    useEffect(() => {
        return () => {
            setNativeCallSessionActive(false);
        };
    }, []);

    const setCallStatus = useCallback(
        (nextStatus: CallStatus, reason = 'state_update') => {
            const currentStatus = statusRef.current;
            if (!allowCallTransition(currentStatus, nextStatus)) {
                callWarn(
                    'CALL_ERROR',
                    'invalid call state transition ignored',
                    {
                        from: currentStatus,
                        to: nextStatus,
                        reason,
                        callId: callIdRef.current,
                    },
                );
                warnDev(
                    '[SocialMobile] Invalid call state transition ignored',
                    {
                        from: currentStatus,
                        to: nextStatus,
                        reason,
                        callId: callIdRef.current,
                    },
                );
                return false;
            }

            if (currentStatus !== nextStatus) {
                callLog('CALL_START', 'call state transition', {
                    from: currentStatus,
                    to: nextStatus,
                    reason,
                    callId: callIdRef.current,
                });
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

    const setDefaultSpeakerphoneForCallType = useCallback(
        (nextCallType: CallType) => {
            const nextSpeakerphoneOn =
                defaultSpeakerphoneForCallType(nextCallType);
            speakerphoneOnRef.current = nextSpeakerphoneOn;
            setSpeakerphoneOn(nextSpeakerphoneOn);
        },
        [],
    );

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

    useEffect(() => {
        const pc = pcRef.current;
        const callId = callIdRef.current;
        if (!pc || !callId) {
            return;
        }

        applyAudioSenderQuality(
            pc,
            networkConnected,
            callId,
            getPeerConnectionId(pc),
        ).catch(() => undefined);
        if (callTypeRef.current === 'video') {
            applyVideoSenderQuality(
                pc,
                localVideoProfileRef.current,
                networkConnected,
                callId,
                getPeerConnectionId(pc),
            ).catch(() => undefined);
        }
    }, [getPeerConnectionId, networkConnected]);

    useEffect(() => {
        return NetInfo.addEventListener(state => {
            const pc = pcRef.current;
            const callId = callIdRef.current;
            if (!pc || !callId) {
                return;
            }

            const connected = state.isConnected !== false;
            applyAudioSenderQuality(
                pc,
                connected,
                callId,
                getPeerConnectionId(pc),
            ).catch(() => undefined);
            if (callTypeRef.current === 'video') {
                applyVideoSenderQuality(
                    pc,
                    localVideoProfileRef.current,
                    connected,
                    callId,
                    getPeerConnectionId(pc),
                ).catch(() => undefined);
            }
        });
    }, [getPeerConnectionId]);

    const stopCallStatsPolling = useCallback(() => {
        if (callStatsTimerRef.current) {
            clearInterval(callStatsTimerRef.current);
            callStatsTimerRef.current = null;
        }
        callStatsAccumulatorRef.current = createCallStatsAccumulator();
        setDiagnostics(null);
    }, []);

    const sampleCallQualityStats = useCallback(
        async (
            pc: PeerConnection,
            callId: string,
            pcId: number | null,
            reason: string,
        ) => {
            try {
                const videoTrack = localStreamRef.current?.getVideoTracks()[0] as
                    | (MediaStreamTrack & {
                          getSettings?: () => {
                              width?: number;
                              height?: number;
                              frameRate?: number;
                              facingMode?: string;
                          };
                      })
                    | undefined;
                const stats = await collectWebRTCDiagnostics(
                    pc as PeerConnection & {
                        getStats?: () => Promise<unknown>;
                    },
                    callStatsAccumulatorRef.current,
                    videoTrack?.getSettings?.() ?? null,
                );
                if (!stats) {
                    callWarn('CALL_WEBRTC', 'getStats is unavailable', {
                        callId,
                        pcId,
                        reason,
                    });
                    return;
                }

                setDiagnostics(stats);

                callLog('CALL_WEBRTC', 'call quality stats', {
                    callId,
                    pcId,
                    reason,
                    connectionState: pc.connectionState,
                    iceConnectionState: pc.iceConnectionState,
                    stats,
                });
                logDev('[SocialMobile] Call quality stats', {
                    callId,
                    pcId,
                    reason,
                    stats,
                });
                logDev('[WebRTC][Outbound video]', {
                    callId,
                    pcId,
                    ...stats.outboundVideo,
                    roundTripTimeMs:
                        stats.outboundVideo?.roundTripTimeMs ??
                        stats.candidatePair?.currentRoundTripTimeMs ??
                        null,
                    selectedCandidatePair: stats.candidatePair?.id ?? null,
                    localCandidateType:
                        stats.candidatePair?.localCandidateType ?? null,
                    remoteCandidateType:
                        stats.candidatePair?.remoteCandidateType ?? null,
                    availableOutgoingBitrate:
                        stats.candidatePair?.availableOutgoingBitrate ?? null,
                });
                logDev('[WebRTC][Inbound video]', {
                    callId,
                    pcId,
                    ...stats.inboundVideo,
                    selectedCandidatePair: stats.candidatePair?.id ?? null,
                    localCandidateType:
                        stats.candidatePair?.localCandidateType ?? null,
                    remoteCandidateType:
                        stats.candidatePair?.remoteCandidateType ?? null,
                });
            } catch (statsError) {
                logCallError('CALL_ERROR', 'failed to collect call stats', {
                    callId,
                    pcId,
                    reason,
                    error: describeCallError(statsError),
                });
            }
        },
        [],
    );

    const startCallStatsPolling = useCallback(
        (pc: PeerConnection, callId: string, pcId: number | null) => {
            stopCallStatsPolling();
            if (!__DEV__) {
                return;
            }
            callStatsAccumulatorRef.current = createCallStatsAccumulator();

            const sample = (reason = 'interval') => {
                if (pcRef.current !== pc || callIdRef.current !== callId) {
                    return;
                }
                sampleCallQualityStats(pc, callId, pcId, reason).catch(
                    () => undefined,
                );
            };

            sample('start');
            callStatsTimerRef.current = setInterval(
                () => sample(),
                callStatsIntervalMs,
            );
        },
        [sampleCallQualityStats, stopCallStatsPolling],
    );

    const closePeerConnection = useCallback(() => {
        clearDisconnectTimer();
        stopCallStatsPolling();
        const pc = pcRef.current;
        if (pc) {
            callLog('CALL_WEBRTC', 'closing peer connection', {
                callId: pcCallIdRef.current,
                pcId: pcIdsRef.current.get(pc) ?? null,
                nativePcId: pc._pcId,
            });
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
        iceRestartInFlightRef.current = false;
    }, [clearDisconnectTimer, stopCallStatsPolling]);

    const sendTerminalCallAction = useCallback(
        (action: 'end' | 'reject', targetId: number, callId: string) => {
            const key = `${action}:${callId}`;
            if (terminalActionInFlightRef.current.has(key)) {
                callWarn(
                    'CALL_WS',
                    'terminal call action skipped while in flight',
                    {
                        action,
                        callId,
                        targetId,
                    },
                );
                return;
            }
            terminalActionInFlightRef.current.add(key);
            callLog('CALL_API', 'terminal call action started', {
                action,
                callId,
                targetId,
            });

            const request =
                action === 'reject'
                    ? callsApi.rejectCall(callId)
                    : callsApi.endCall(callId);
            request
                .catch(terminalError => {
                    logCallError(
                        'CALL_ERROR',
                        'terminal call REST action failed',
                        {
                            action,
                            callId,
                            targetId,
                            error: describeCallError(terminalError),
                        },
                    );
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
                        logCallError(
                            'CALL_ERROR',
                            'terminal call WS fallback failed',
                            {
                                action,
                                callId,
                                targetId,
                                error: describeCallError(sendError),
                            },
                        );
                        warnDev(
                            '[SocialMobile] Call terminal WS fallback failed',
                            {
                                action,
                                callId,
                                sendError,
                            },
                        );
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
                buffered.push({ toId, candidate });
                outgoingIceBufferRef.current.set(callId, buffered.slice(-64));
                callLog(
                    'CALL_WEBRTC',
                    'buffering outgoing ICE before signaling ready',
                    {
                        callId,
                        pcId: getPeerConnectionId(pcRef.current),
                        toId,
                        type: iceCandidateType(candidate),
                        bufferedIce: buffered.length,
                    },
                );
                logDev(
                    '[SocialMobile] Buffering outgoing ICE before signaling ready',
                    {
                        callId,
                        pcId: getPeerConnectionId(pcRef.current),
                        toId,
                        type: iceCandidateType(candidate),
                    },
                );
                return;
            }

            callLog('CALL_WS', 'sending call ICE candidate', {
                callId,
                toId,
                type: iceCandidateType(candidate),
            });
            chatSocket.sendCallIce(toId, candidate, callId);
        },
        [getPeerConnectionId],
    );

    const markCallSignalingReady = useCallback(
        (callId: string, toId: number) => {
            signalingReadyCallIdsRef.current.add(callId);
            const buffered = outgoingIceBufferRef.current.get(callId) ?? [];
            outgoingIceBufferRef.current.delete(callId);
            callLog('CALL_WS', 'call signaling ready', {
                callId,
                pcId: getPeerConnectionId(pcRef.current),
                toId,
                bufferedIce: buffered.length,
            });
            logDev(
                '[SocialMobile] Call signaling ready; flushing outgoing ICE',
                {
                    callId,
                    pcId: getPeerConnectionId(pcRef.current),
                    bufferedIce: buffered.length,
                },
            );
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
        iceRestartInFlightRef.current = false;
        setLocalStream(null);
        setRemoteStream(null);
        setMicrophoneOn(true);
        setCameraOn(true);
        speakerphoneOnRef.current = false;
        setSpeakerphoneOn(false);
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
            const targetId =
                peerUserIdRef.current ?? pendingOfferRef.current?.fromId;

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
            iceRestartInFlightRef.current = false;
            setLocalStream(null);
            setRemoteStream(null);
            setMicrophoneOn(true);
            setCameraOn(true);
            speakerphoneOnRef.current = false;
            setSpeakerphoneOn(false);
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
                        iceCandidateDedupKey(
                            pending,
                            iceCandidateFromId(pending),
                        ) === key,
                )
            ) {
                callLog(
                    'CALL_WEBRTC',
                    'duplicate pending ICE candidate ignored',
                    {
                        source,
                        callId: callIdRef.current,
                        pcId: getPeerConnectionId(pcRef.current),
                        fromId,
                        type: iceCandidateType(candidate),
                    },
                );
                logDev(
                    '[SocialMobile] Duplicate pending ICE candidate ignored',
                    {
                        source,
                        callId: callIdRef.current,
                        pcId: getPeerConnectionId(pcRef.current),
                        fromId,
                        type: iceCandidateType(candidate),
                    },
                );
                return;
            }

            pendingIceRef.current.push(candidate);
            callLog(
                'CALL_WEBRTC',
                'queued ICE candidate until remote description',
                {
                    source,
                    callId: callIdRef.current,
                    pcId: getPeerConnectionId(pcRef.current),
                    fromId,
                    type: iceCandidateType(candidate),
                    bufferedIce: pendingIceRef.current.length,
                },
            );
            logDev(
                '[SocialMobile] Queuing ICE candidate until remoteDescription',
                {
                    source,
                    callId: callIdRef.current,
                    pcId: getPeerConnectionId(pcRef.current),
                    fromId,
                    type: iceCandidateType(candidate),
                    bufferedIce: pendingIceRef.current.length,
                },
            );
        },
        [getPeerConnectionId],
    );

    const flushPendingIce = useCallback(async () => {
        const pc = pcRef.current;
        if (!pc?.remoteDescription) {
            callWarn('CALL_WEBRTC', 'buffered ICE flush skipped', {
                callId: callIdRef.current,
                pcId: getPeerConnectionId(pc),
                hasPeerConnection: Boolean(pc),
                hasRemoteDescription: Boolean(pc?.remoteDescription),
                bufferedIce: pendingIceRef.current.length,
            });
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
        callLog('CALL_WEBRTC', 'flushing buffered ICE candidates', {
            callId: pcCallIdRef.current,
            pcId: getPeerConnectionId(pc),
            count: pending.length,
        });
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
            const added = await addIceCandidateSafely(
                pc,
                candidate,
                'pending',
                {
                    callId: pcCallIdRef.current,
                    pcId: getPeerConnectionId(pc),
                    fromId,
                },
            );
            if (added) {
                appliedRemoteIceKeysRef.current.add(key);
            }
        }
    }, [getPeerConnectionId]);

    const applyRestoredIceCandidates = useCallback(
        async (call: ActiveCall, reason: string) => {
            const userId = user?.id;
            if (!userId) {
                callWarn(
                    'CALL_ERROR',
                    'restored ICE skipped without current user',
                    {
                        reason,
                        callId: call.call_id,
                    },
                );
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

            callLog('CALL_WEBRTC', 'active call restored ICE candidates', {
                reason,
                callId: call.call_id,
                pcId,
                totalIce: call.ice_candidates?.length ?? 0,
                remoteIce: restoredCandidates.length,
            });
            logDev('[SocialMobile] Active call restored ICE candidates', {
                reason,
                callId: call.call_id,
                pcId,
                totalIce: call.ice_candidates?.length ?? 0,
                remoteIce: restoredCandidates.length,
            });

            if (!pc || pcCallIdRef.current !== call.call_id) {
                callWarn(
                    'CALL_WEBRTC',
                    'restored ICE skipped without current PC',
                    {
                        reason,
                        callId: call.call_id,
                        pcCallId: pcCallIdRef.current,
                        pcId,
                        remoteIce: restoredCandidates.length,
                    },
                );
                logDev(
                    '[SocialMobile] Restored ICE skipped without current PC',
                    {
                        reason,
                        callId: call.call_id,
                        pcCallId: pcCallIdRef.current,
                        pcId,
                        remoteIce: restoredCandidates.length,
                    },
                );
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
                const added = await addIceCandidateSafely(
                    pc,
                    candidate,
                    'restored',
                    {
                        callId: call.call_id,
                        pcId,
                        fromId,
                    },
                );
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
                callWarn('CALL_ERROR', 'active call restore skipped', {
                    reason,
                    callId: call.call_id,
                    currentUserId: userId ?? null,
                    currentCallId: callIdRef.current,
                });
                return false;
            }

            const peerId = callPeerId(call, userId);
            const pc = pcRef.current;
            const pcId = getPeerConnectionId(pc);
            const restoredIceCount = call.ice_candidates?.length ?? 0;

            callLog('CALL_START', 'active call restore', {
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
            const restoredCallType =
                call.call_type === 'video' ? 'video' : 'audio';
            setCurrentCallType(restoredCallType);
            if (
                statusRef.current !== 'active' &&
                statusRef.current !== 'reconnecting'
            ) {
                setDefaultSpeakerphoneForCallType(restoredCallType);
            }

            if (
                call.offer &&
                call.callee_id === userId &&
                (statusRef.current === 'incoming' ||
                    statusRef.current === 'connecting')
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
                callLog('CALL_WEBRTC', 'restoring call answer', {
                    callId: call.call_id,
                    pcId,
                    answer: summarizeSdp(call.answer.sdp),
                });
                logDev('[SocialMobile] Restoring call answer', {
                    callId: call.call_id,
                    pcId,
                    answer: summarizeSdp(call.answer.sdp),
                });
                await pc.setRemoteDescription(
                    new RTCSessionDescription(call.answer),
                );
                if (
                    pcRef.current !== pc ||
                    callIdRef.current !== call.call_id
                ) {
                    return false;
                }
                logPeerState(pc, call.call_id, 'remote-answer-restored', pcId);
                await flushPendingIce();
                if (statusRef.current !== 'active') {
                    setCallStatus(
                        'connecting',
                        'answer_restored_waiting_for_media',
                    );
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
            setDefaultSpeakerphoneForCallType,
            user?.id,
        ],
    );

    const showHydratedIncomingCall = useCallback(
        async (call: ActiveCall, fallbackName?: string) => {
            if (!shouldShowIncomingServerCall(call, user?.id)) {
                callWarn(
                    'CALL_START',
                    'incoming active call restore skipped by server state',
                    {
                        callId: call.call_id,
                        status: call.status,
                        currentUserId: user?.id ?? null,
                        callerId: call.caller_id,
                        calleeId: call.callee_id,
                        hasOffer: Boolean(call.offer),
                    },
                );
                return false;
            }

            if (
                statusRef.current !== 'idle' &&
                !(
                    statusRef.current === 'incoming' &&
                    callIdRef.current === call.call_id
                )
            ) {
                callWarn(
                    'CALL_START',
                    'incoming active call restore skipped by local state',
                    {
                        callId: call.call_id,
                        localStatus: statusRef.current,
                        currentCallId: callIdRef.current,
                    },
                );
                return false;
            }

            pendingOfferRef.current = {
                fromId: call.caller_id,
                callId: call.call_id,
                offer: call.offer!,
                callType: call.call_type === 'video' ? 'video' : 'audio',
            };
            pendingIceRef.current = call.ice_candidates ?? [];
            callLog('CALL_START', 'incoming active call restored', {
                callId: call.call_id,
                pcId: getPeerConnectionId(pcRef.current),
                hasOffer: Boolean(call.offer),
                hasAnswer: Boolean(call.answer),
                restoredIceCount: pendingIceRef.current.length,
                status: call.status,
            });
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
            const restoredCallType =
                call.call_type === 'video' ? 'video' : 'audio';
            setCurrentCallType(restoredCallType);
            setDefaultSpeakerphoneForCallType(restoredCallType);
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
            setDefaultSpeakerphoneForCallType,
            user?.id,
        ],
    );

    const hydrateIncomingCall = useCallback(
        async (callId?: string | null, fallbackName?: string) => {
            const userId = user?.id;
            if (!userId) {
                callWarn(
                    'CALL_ERROR',
                    'hydrate incoming call skipped without user id',
                    {
                        callId: callId ?? null,
                    },
                );
                return;
            }

            const normalizedCallId = callId?.trim();
            if (normalizedCallId) {
                if (
                    callIdRef.current === normalizedCallId &&
                    statusRef.current === 'incoming' &&
                    pendingOfferRef.current
                ) {
                    callLog(
                        'CALL_START',
                        'hydrate skipped for already pending incoming call',
                        {
                            callId: normalizedCallId,
                        },
                    );
                    return;
                }
                if (hydratingCallIdsRef.current.has(normalizedCallId)) {
                    callLog(
                        'CALL_START',
                        'hydrate skipped because call id is already hydrating',
                        {
                            callId: normalizedCallId,
                        },
                    );
                    return;
                }
                hydratingCallIdsRef.current.add(normalizedCallId);
            } else {
                if (hydratingActiveRef.current) {
                    callLog(
                        'CALL_START',
                        'active call hydrate skipped because hydrate is in flight',
                    );
                    return;
                }
                hydratingActiveRef.current = true;
            }

            try {
                callLog('CALL_API', 'hydrate active call started', {
                    callId: normalizedCallId || null,
                    fallbackNameProvided: Boolean(fallbackName),
                });
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
                        callLog(
                            'CALL_START',
                            'active call hydrate skipped during outgoing setup',
                            {
                                callId: currentCallId,
                            },
                        );
                        return;
                    }

                    if (
                        currentCallId &&
                        (!normalizedCallId ||
                            currentCallId === normalizedCallId) &&
                        statusRef.current !== 'idle' &&
                        statusRef.current !== 'ended' &&
                        statusRef.current !== 'error'
                    ) {
                        finishCall('ended');
                    }
                    if (normalizedCallId) {
                        await rememberTerminalIncomingCall(
                            normalizedCallId,
                        ).catch(() => undefined);
                    }
                    return;
                }

                if (
                    isTerminalCallStatus(call.status) ||
                    !isLiveServerCall(call)
                ) {
                    callLog(
                        'CALL_START',
                        'hydrated call is terminal or not live',
                        {
                            callId: call.call_id,
                            status: call.status,
                        },
                    );
                    await rememberTerminalIncomingCall(call.call_id).catch(
                        () => undefined,
                    );
                    if (
                        callIdRef.current === call.call_id &&
                        statusRef.current !== 'idle'
                    ) {
                        finishCall('ended');
                    } else if (
                        pendingIncomingCallPushRef.current?.callId ===
                        call.call_id
                    ) {
                        pendingIncomingCallPushRef.current = null;
                        clearPendingIncomingCall(call.call_id).catch(
                            () => undefined,
                        );
                        cancelIncomingCallNotification(call.call_id).catch(
                            () => undefined,
                        );
                    }
                    return;
                }

                if (shouldKeepLocalServerCall(call, currentCallId)) {
                    callLog(
                        'CALL_START',
                        'active call hydrate kept local call',
                        {
                            callId: call.call_id,
                            status: call.status,
                            localStatus: statusRef.current,
                            pcId: getPeerConnectionId(pcRef.current),
                            hasOffer: Boolean(call.offer),
                            hasAnswer: Boolean(call.answer),
                            iceCandidates: call.ice_candidates?.length ?? 0,
                        },
                    );
                    logDev(
                        '[SocialMobile] Active call hydrate kept local call',
                        {
                            callId: call.call_id,
                            status: call.status,
                            localStatus: statusRef.current,
                            pcId: getPeerConnectionId(pcRef.current),
                            hasOffer: Boolean(call.offer),
                            hasAnswer: Boolean(call.answer),
                            iceCandidates: call.ice_candidates?.length ?? 0,
                        },
                    );
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
                        callsApi
                            .rejectCall(call.call_id)
                            .catch(() => undefined);
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
                logCallError('CALL_ERROR', 'failed to hydrate incoming call', {
                    callId: normalizedCallId || null,
                    error: describeCallError(hydrateError),
                });
                warnDev(
                    '[SocialMobile] Failed to hydrate incoming call',
                    hydrateError,
                );
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
                callWarn('CALL_START', 'pending incoming call push ignored', {
                    callId: call.callId,
                    callerId: call.callerId,
                    currentUserId: user?.id ?? null,
                    status: statusRef.current,
                    reason: !user?.id
                        ? 'missing_user'
                        : call.callerId === user.id
                        ? 'self_call'
                        : 'busy',
                });
                return;
            }

            pendingIncomingCallPushRef.current = call;
            hydrateIncomingCall(call.callId, call.callerName).catch(
                hydrateError => {
                    logCallError(
                        'CALL_ERROR',
                        'pending incoming call hydrate failed',
                        {
                            callId: call.callId,
                            callerId: call.callerId,
                            error: describeCallError(hydrateError),
                        },
                    );
                },
            );
            callLog('CALL_START', 'pending incoming call push staged', {
                callId: call.callId,
                callerId: call.callerId,
                conversationId: call.conversationId,
            });
            logDev('[SocialMobile] Pending incoming call push staged', {
                callId: call.callId,
                callerId: call.callerId,
                conversationId: call.conversationId,
            });
        },
        [hydrateIncomingCall, user?.id],
    );

    const openLocalStream = useCallback(async (nextCallType: CallType) => {
        callLog('CALL_WEBRTC', 'opening local media stream', {
            callType: nextCallType,
        });
        const permissionsGranted = await requestCallPermissions(nextCallType);
        if (!permissionsGranted) {
            callWarn('CALL_ERROR', 'local media blocked by permissions', {
                callType: nextCallType,
            });
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
                for (const profile of videoProfileFallbackChain(
                    initialProfile,
                )) {
                    try {
                        callLog('CALL_WEBRTC', 'getUserMedia requested', {
                            callType: 'video',
                            profile,
                        });
                        logDev(
                            '[SocialMobile] getUserMedia requested for video call',
                            {
                                profile,
                            },
                        );
                        stream = await mediaDevices.getUserMedia({
                            audio: callAudioConstraints,
                            video: videoConstraints(profile),
                        });
                        selectedProfile = profile;
                        break;
                    } catch (profileError) {
                        lastVideoError = profileError;
                        logCallError(
                            'CALL_ERROR',
                            'video getUserMedia profile failed',
                            {
                                profile,
                                error: describeCallError(profileError),
                            },
                        );
                        warnDev(
                            '[SocialMobile] Video profile failed, trying fallback',
                            {
                                profile,
                                error: profileError,
                            },
                        );
                    }
                }
                if (!stream) {
                    throw (
                        lastVideoError || new Error('call video track missing')
                    );
                }
            } else {
                callLog('CALL_WEBRTC', 'getUserMedia requested', {
                    callType: 'audio',
                });
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
                logCallError('CALL_ERROR', 'local media has no audio track', {
                    callType: nextCallType,
                    videoTracks: videoTracks.length,
                });
                throw new Error('call audio track missing');
            }

            if (nextCallType === 'video' && videoTracks.length === 0) {
                stopStream(stream);
                logCallError(
                    'CALL_ERROR',
                    'local video media has no video track',
                    {
                        audioTracks: audioTracks.length,
                    },
                );
                throw new Error('call video track missing');
            }

            callLog('CALL_WEBRTC', 'local media stream opened', {
                callType: nextCallType,
                audioTracks: audioTracks.length,
                videoTracks: videoTracks.length,
                tracks: summarizeStreamTracks(stream),
            });
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

            logCallError('CALL_ERROR', 'getUserMedia failed', {
                callType: nextCallType,
                error: describeCallError(streamError),
            });
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
                logCallError(
                    'CALL_ERROR',
                    'video stream failed, falling back to audio',
                    {
                        error: describeCallError(streamError),
                        callId: callIdRef.current,
                    },
                );
                warnDev(
                    '[SocialMobile] Video stream failed, falling back to audio',
                    {
                        error: streamError,
                        callId: callIdRef.current,
                    },
                );
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
                callWarn(
                    'CALL_WEBRTC',
                    'local video profile skipped for non-video call',
                    {
                        callId: callIdRef.current,
                        callType: callTypeRef.current,
                    },
                );
                return false;
            }

            const track = localStreamRef.current?.getVideoTracks()[0] as
                | ConstraintCapableTrack
                | undefined;
            if (
                !track ||
                track.readyState === 'ended' ||
                !track.applyConstraints
            ) {
                callWarn(
                    'CALL_WEBRTC',
                    'local video profile skipped without live track',
                    {
                        callId: callIdRef.current,
                        hasTrack: Boolean(track),
                        readyState: track?.readyState,
                        hasApplyConstraints: Boolean(track?.applyConstraints),
                    },
                );
                return false;
            }

            try {
                await track.applyConstraints(videoConstraints(profile));
                localVideoProfileRef.current = profile;
                await applyVideoSenderQuality(
                    pcRef.current,
                    profile,
                    networkConnectedRef.current,
                    callIdRef.current,
                    getPeerConnectionId(pcRef.current),
                );
                logDev('[SocialMobile] Local video profile applied', {
                    profile,
                    callId: callIdRef.current,
                });
                callLog('CALL_WEBRTC', 'local video profile applied', {
                    profile,
                    callId: callIdRef.current,
                });
                return true;
            } catch (profileError) {
                logCallError(
                    'CALL_ERROR',
                    'failed to apply local video profile',
                    {
                        profile,
                        callId: callIdRef.current,
                        error: describeCallError(profileError),
                    },
                );
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

    const requestIceRestart = useCallback(
        async (
            pc: PeerConnection,
            toId: number,
            callId: string,
            pcId: number | null,
            reason: string,
        ) => {
            if (iceRestartInFlightRef.current) {
                callWarn('CALL_WEBRTC', 'ICE restart skipped while in flight', {
                    callId,
                    pcId,
                    reason,
                });
                return;
            }

            if (pc.signalingState !== 'stable') {
                callWarn('CALL_WEBRTC', 'ICE restart skipped outside stable signaling', {
                    callId,
                    pcId,
                    reason,
                    signalingState: pc.signalingState,
                });
                return;
            }

            iceRestartInFlightRef.current = true;
            try {
                const restartIce = (
                    pc as PeerConnection & { restartIce?: () => void }
                ).restartIce;
                restartIce?.call(pc);
                await applyAudioSenderQuality(
                    pc,
                    networkConnectedRef.current,
                    callId,
                    pcId,
                );
                const audioProfile = await initialAudioQualityProfile(
                    networkConnectedRef.current,
                );
                const createOffer = (
                    pc as PeerConnection & {
                        createOffer: (options?: {
                            iceRestart?: boolean;
                        }) => Promise<CallSessionDescription>;
                    }
                ).createOffer;
                const restartOffer = preferOpusInSessionDescription(
                    sessionDescriptionForSignal(
                        await createOffer.call(pc, { iceRestart: true }),
                    ),
                    audioProfile,
                );
                const restartSummary = summarizeSdp(restartOffer.sdp);

                callLog('CALL_WEBRTC', 'ICE restart offer created', {
                    callId,
                    pcId,
                    reason,
                    audioProfile,
                    summary: restartSummary,
                });
                if (!restartSummary.hasOpus) {
                    callWarn('CALL_WEBRTC', 'ICE restart offer has no Opus codec', {
                        callId,
                        pcId,
                        audioCodecs: restartSummary.audioCodecs,
                    });
                }

                await pc.setLocalDescription(
                    new RTCSessionDescription(restartOffer),
                );

                if (
                    pcRef.current !== pc ||
                    callIdRef.current !== callId ||
                    pcCallIdRef.current !== callId
                ) {
                    callWarn('CALL_WEBRTC', 'ICE restart offer became stale', {
                        callId,
                        pcId,
                        reason,
                    });
                    return;
                }

                localOfferPeerRef.current = {
                    callId,
                    pcId: pcId ?? -1,
                };
                const localOffer = sessionDescriptionForSignal(
                    pc.localDescription,
                    restartOffer,
                );
                const sent = chatSocket.sendCallOffer(
                    toId,
                    localOffer,
                    callTypeRef.current,
                    callId,
                );
                callLog('CALL_WS', 'ICE restart offer signaled', {
                    callId,
                    pcId,
                    toId,
                    reason,
                    sent,
                    sdp: summarizeSdp(localOffer.sdp),
                });
            } catch (restartError) {
                logCallError('CALL_ERROR', 'ICE restart renegotiation failed', {
                    callId,
                    pcId,
                    reason,
                    error: describeCallError(restartError),
                });
            } finally {
                iceRestartInFlightRef.current = false;
            }
        },
        [],
    );

    const createPeerConnection = useCallback(
        (toId: number, callId: string) => {
            const existingPc = pcRef.current;
            if (existingPc && pcCallIdRef.current === callId) {
                callLog('CALL_WEBRTC', 'reusing peer connection', {
                    callId,
                    pcId: getPeerConnectionId(existingPc),
                    nativePcId: existingPc._pcId,
                    toId,
                });
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
            callLog('CALL_WEBRTC', 'creating peer connection', {
                callId,
                toId,
                iceTransportPolicy: WEBRTC_FORCE_RELAY ? 'relay' : 'all',
                iceServers: servers.map(server => ({
                    urls: server.urls,
                    hasUsername: Boolean(server.username),
                    usernameLen: server.username?.length ?? 0,
                    hasCredential: Boolean(server.credential),
                    credentialLen: server.credential?.length ?? 0,
                })),
            });
            const pc = new RTCPeerConnection({
                iceServers: servers,
                iceTransportPolicy: WEBRTC_FORCE_RELAY ? 'relay' : 'all',
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
                const existingTracks =
                    remoteStreamRef.current?.getTracks() ?? [];
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
                callLog('CALL_WEBRTC', 'remote stream updated', {
                    callId,
                    pcId,
                    streamId: nextStream.id,
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
                    callLog('CALL_WEBRTC', 'ICE candidate generated', {
                        callId,
                        pcId,
                        toId,
                        type: iceCandidateType(payload),
                        sdpMid: payload.sdpMid,
                        sdpMLineIndex: payload.sdpMLineIndex,
                    });
                    logDev(
                        '[SocialMobile] ICE candidate raw',
                        payload.candidate,
                    );
                    logDev(
                        '[SocialMobile] ICE candidate type',
                        iceCandidateType(payload),
                    );
                    if (!isUsableIceCandidate(payload)) {
                        callWarn(
                            'CALL_WEBRTC',
                            'skipping empty outgoing ICE candidate',
                            {
                                callId,
                                pcId,
                            },
                        );
                        logDev(
                            '[SocialMobile] Skipping empty outgoing ICE candidate',
                            {
                                callId,
                                pcId,
                            },
                        );
                        return;
                    }

                    callLog('CALL_WS', 'sending outgoing ICE candidate', {
                        callId,
                        pcId,
                        toId,
                        type: iceCandidateType(payload),
                        sdpMid: payload.sdpMid,
                        sdpMLineIndex: payload.sdpMLineIndex,
                    });
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
                    logCallError('CALL_ERROR', 'failed to send ICE candidate', {
                        callId,
                        pcId,
                        toId,
                        error: describeCallError(sendError),
                    });
                    warnDev(
                        '[SocialMobile] Failed to send ICE candidate',
                        sendError,
                    );
                }
            };

            const handleTrack = (event: unknown) => {
                if (!isCurrentConnection()) {
                    return;
                }

                const track = (event as { track?: MediaStreamTrack | null })
                    .track;
                const [stream] =
                    (event as { streams?: MediaStream[] }).streams ?? [];
                logDev('[SocialMobile] Remote track event', {
                    callId,
                    pcId,
                    trackKind: track?.kind,
                    track: track ? summarizeTrack(track) : null,
                    streamCount:
                        (event as { streams?: MediaStream[] }).streams
                            ?.length ?? 0,
                    streams:
                        (event as { streams?: MediaStream[] }).streams?.map(
                            summarizeStreamTracks,
                        ) ?? [],
                });
                callLog('CALL_WEBRTC', 'remote track event', {
                    callId,
                    pcId,
                    trackKind: track?.kind,
                    track: track ? summarizeTrack(track) : null,
                    streamCount:
                        (event as { streams?: MediaStream[] }).streams
                            ?.length ?? 0,
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
                    if (
                        iceRecoveryAttemptsRef.current < maxIceRecoveryAttempts
                    ) {
                        iceRecoveryAttemptsRef.current += 1;
                        callLog('CALL_WEBRTC', 'ICE restart requested', {
                            callId,
                            pcId,
                            attempt: iceRecoveryAttemptsRef.current,
                            reason: 'peer_disconnected',
                        });
                        requestIceRestart(
                            pc,
                            toId,
                            callId,
                            pcId,
                            'peer_disconnected',
                        ).catch(restartError => {
                            logCallError(
                                'CALL_ERROR',
                                'ICE restart request failed',
                                {
                                    callId,
                                    pcId,
                                    error: describeCallError(restartError),
                                },
                            );
                        });
                        logDev('[SocialMobile] ICE restart requested', {
                            callId,
                            pcId,
                            attempt: iceRecoveryAttemptsRef.current,
                            reason: 'peer_disconnected',
                        });
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
                            if (
                                iceRecoveryAttemptsRef.current <
                                maxIceRecoveryAttempts
                            ) {
                                handlePeerStateChange('ice-recovery-timeout');
                                return;
                            }
                            finishCall(
                                'error',
                                'Соединение звонка прервано.',
                                true,
                            );
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
                        callLog(
                            'CALL_WEBRTC',
                            'ICE restart requested after failure',
                            {
                                callId,
                                pcId,
                                attempt: iceRecoveryAttemptsRef.current,
                                reason: 'peer_failed',
                            },
                        );
                        requestIceRestart(
                            pc,
                            toId,
                            callId,
                            pcId,
                            'peer_failed',
                        ).catch(restartError => {
                            logCallError(
                                'CALL_ERROR',
                                'ICE restart after failure request failed',
                                {
                                    callId,
                                    pcId,
                                    error: describeCallError(restartError),
                                },
                            );
                        });
                        logDev(
                            '[SocialMobile] ICE restart requested after failure',
                            {
                                callId,
                                pcId,
                                attempt: iceRecoveryAttemptsRef.current,
                                reason: 'peer_failed',
                            },
                        );
                        return;
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
            peerHandlers.oniceconnectionstatechange =
                handleIceConnectionStateChange;
            peerHandlers.onicegatheringstatechange =
                handleIceGatheringStateChange;
            peerHandlers.onsignalingstatechange = handleSignalingStateChange;
            pcListenerCleanupRef.current = () => {
                eventTarget.removeEventListener?.(
                    'icecandidate',
                    handleIceCandidate,
                );
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
                    peerHandlers.onconnectionstatechange ===
                    handleConnectionStateChange
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
                    peerHandlers.onsignalingstatechange ===
                    handleSignalingStateChange
                ) {
                    peerHandlers.onsignalingstatechange = null;
                }
            };
            startCallStatsPolling(pc, callId, pcId);

            return pc;
        },
        [
            clearDisconnectTimer,
            closePeerConnection,
            applyLocalVideoProfile,
            finishCall,
            getPeerConnectionId,
            requestIceRestart,
            sendOrBufferOutgoingIce,
            setCallStatus,
            startCallStatsPolling,
        ],
    );

    const startCall = useCallback(
        async (
            toId: number,
            name: string | undefined,
            nextCallType: CallType,
        ) => {
            logCallEnvOnce('start_call');
            const targetId = normalizeCallUserId(toId);
            callLog('CALL_START', 'start call requested', {
                toId,
                targetId,
                peerNameProvided: Boolean(name),
                callType: nextCallType,
                currentUserId: user?.id ?? null,
                status: statusRef.current,
                startInFlight: startInFlightRef.current,
            });
            if (!targetId) {
                callWarn(
                    'CALL_ERROR',
                    'call start blocked without valid peer id',
                    {
                        toId,
                        callType: nextCallType,
                    },
                );
                showCallError('Не удалось определить собеседника для звонка.');
                return;
            }

            if (!user?.id) {
                callWarn(
                    'CALL_ERROR',
                    'call start blocked without current user id',
                    {
                        toId: targetId,
                        callType: nextCallType,
                        status: statusRef.current,
                    },
                );
                showCallError('Не удалось определить текущего пользователя.');
                return;
            }

            if (statusRef.current !== 'idle' || startInFlightRef.current) {
                callWarn(
                    'CALL_START',
                    'duplicate or invalid call start ignored',
                    {
                        toId: targetId,
                        callType: nextCallType,
                        status: statusRef.current,
                        startInFlight: startInFlightRef.current,
                    },
                );
                logDev(
                    '[SocialMobile] Ignoring duplicate or invalid call start',
                    {
                        toId: targetId,
                        callType: nextCallType,
                        status: statusRef.current,
                        startInFlight: startInFlightRef.current,
                    },
                );
                return;
            }

            startInFlightRef.current = true;
            clearEndTimer();
            setError(null);
            const callId = createCallId();
            callIdRef.current = callId;
            setCallPeer(targetId);
            setPeerName(name || 'Пользователь');
            setCurrentCallType(nextCallType);
            setDefaultSpeakerphoneForCallType(nextCallType);
            setCallStatus('connecting');
            callLog('CALL_START', 'outgoing call setup started', {
                callId,
                toId: targetId,
                callType: nextCallType,
            });

            try {
                const isCurrentStart = () =>
                    callIdRef.current === callId &&
                    peerUserIdRef.current === targetId &&
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

                callLog(
                    'CALL_WS',
                    'connect requested before outgoing call offer',
                    {
                        callId,
                        toId: targetId,
                    },
                );
                const { stream, callType: effectiveCallType } =
                    await openLocalStreamWithFallback(nextCallType);
                if (!isCurrentStart()) {
                    callWarn(
                        'CALL_START',
                        'outgoing call became stale after media open',
                        {
                            callId,
                            toId: targetId,
                            status: statusRef.current,
                        },
                    );
                    cleanupStaleStart(stream);
                    return;
                }
                setCurrentCallType(effectiveCallType);
                setDefaultSpeakerphoneForCallType(effectiveCallType);

                const pc = createPeerConnection(targetId, callId);
                if (!isCurrentStart()) {
                    callWarn(
                        'CALL_START',
                        'outgoing call became stale after peer connection',
                        {
                            callId,
                            toId: targetId,
                            status: statusRef.current,
                        },
                    );
                    cleanupStaleStart(stream, pc);
                    return;
                }
                const pcId = getPeerConnectionId(pc);

                callLog('CALL_WEBRTC', 'adding local tracks before offer', {
                    callId,
                    pcId,
                    tracks: summarizeStreamTracks(stream),
                });
                logDev(
                    '[SocialMobile] Adding local tracks before createOffer',
                    {
                        callId,
                        pcId,
                        tracks: summarizeStreamTracks(stream),
                    },
                );
                stream.getTracks().forEach(track => {
                    callLog('CALL_WEBRTC', 'local track added', {
                        callId,
                        pcId,
                        track: summarizeTrack(track),
                    });
                    logDev('[SocialMobile] addTrack(local)', {
                        callId,
                        pcId,
                        track: summarizeTrack(track),
                    });
                    pc.addTrack(track, stream);
                });
                if (effectiveCallType === 'video') {
                    applyVideoCodecPreferences(pc, callId, pcId);
                }
                await applyVideoSenderQuality(
                    pc,
                    localVideoProfileRef.current,
                    networkConnectedRef.current,
                    callId,
                    pcId,
                );
                await applyAudioSenderQuality(
                    pc,
                    networkConnectedRef.current,
                    callId,
                    pcId,
                );

                callLog('CALL_WEBRTC', 'creating call offer', {
                    callId,
                    pcId,
                    callType: effectiveCallType,
                });
                const offerAudioProfile = await initialAudioQualityProfile(
                    networkConnectedRef.current,
                );
                const offer = preferOpusInSessionDescription(
                    sessionDescriptionForSignal(
                        (await pc.createOffer()) as CallSessionDescription,
                    ),
                    offerAudioProfile,
                );
                if (!isCurrentStart()) {
                    callWarn(
                        'CALL_START',
                        'outgoing call became stale after offer create',
                        {
                            callId,
                            toId: targetId,
                            status: statusRef.current,
                        },
                    );
                    cleanupStaleStart(stream, pc);
                    return;
                }
                const offerSummary = summarizeSdp(offer.sdp);
                callLog('CALL_WEBRTC', 'call offer created', {
                    callId,
                    pcId,
                    callType: effectiveCallType,
                    audioProfile: offerAudioProfile,
                    summary: offerSummary,
                });
                logDev('[SocialMobile] createOffer SDP summary', {
                    callId,
                    pcId,
                    callType: effectiveCallType,
                    audioProfile: offerAudioProfile,
                    summary: offerSummary,
                });
                if (!offerSummary.hasOpus) {
                    callWarn('CALL_WEBRTC', 'call offer SDP has no Opus codec', {
                        callId,
                        pcId,
                        audioCodecs: offerSummary.audioCodecs,
                    });
                }
                warnIfOfferSdpNotBidirectional(
                    offerSummary,
                    effectiveCallType,
                    callId,
                    pcId,
                );

                callLog('CALL_WEBRTC', 'setting local offer description', {
                    callId,
                    pcId,
                });
                await pc.setLocalDescription(new RTCSessionDescription(offer));
                if (!isCurrentStart()) {
                    callWarn(
                        'CALL_START',
                        'outgoing call became stale after local offer',
                        {
                            callId,
                            toId: targetId,
                            status: statusRef.current,
                        },
                    );
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
                callLog('CALL_WEBRTC', 'local offer description set', {
                    callId,
                    pcId,
                    signalingState: pc.signalingState,
                    localDescription: summarizeSdp(localOffer.sdp),
                });

                callLog('CALL_WS', 'waiting for websocket before offer', {
                    callId,
                    toId: targetId,
                    timeoutMs: 8000,
                });
                const socketReady = await chatSocket.waitUntilConnected(8000);
                if (!isCurrentStart()) {
                    callWarn(
                        'CALL_START',
                        'outgoing call became stale while waiting for socket',
                        {
                            callId,
                            toId: targetId,
                            status: statusRef.current,
                        },
                    );
                    cleanupStaleStart(stream, pc);
                    return;
                }
                if (!socketReady) {
                    logCallError(
                        'CALL_ERROR',
                        'websocket not connected before offer',
                        {
                            callId,
                            toId: targetId,
                            timeoutMs: 8000,
                        },
                    );
                    throw new Error('WebSocket is not connected');
                }

                callLog('CALL_WS', 'sending call offer', {
                    callId,
                    pcId,
                    toId: targetId,
                    callType: effectiveCallType,
                    sdp: summarizeSdp(localOffer.sdp),
                });
                logDev('[SocialMobile] Sending call offer', {
                    callId,
                    pcId,
                    toId: targetId,
                    callType: effectiveCallType,
                    sdp: summarizeSdp(localOffer.sdp),
                });
                const offerSent = chatSocket.sendCallOffer(
                    targetId,
                    localOffer,
                    effectiveCallType,
                    callId,
                );
                if (!offerSent) {
                    logCallError('CALL_ERROR', 'call offer was not sent', {
                        callId,
                        pcId,
                        toId: targetId,
                    });
                    throw new Error('WebSocket is not connected');
                }
                markCallSignalingReady(callId, targetId);
                setCallStatus('ringing', 'offer_sent');
                callLog('CALL_START', 'outgoing call offer sent', {
                    callId,
                    toId: targetId,
                    callType: effectiveCallType,
                });
            } catch (callError) {
                const message = callErrorMessage(callError);
                logCallError('CALL_ERROR', 'start call failed', {
                    callId,
                    toId: targetId,
                    callType: nextCallType,
                    error: describeCallError(callError),
                });
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
            setDefaultSpeakerphoneForCallType,
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
        logCallEnvOnce('accept_call');
        callLog('CALL_START', 'accept call requested', {
            callId:
                callIdRef.current ?? pendingOfferRef.current?.callId ?? null,
            fromId: pendingOfferRef.current?.fromId ?? null,
            status: statusRef.current,
            acceptInFlight: acceptInFlightRef.current,
        });
        if (acceptInFlightRef.current) {
            callWarn('CALL_START', 'duplicate call accept ignored', {
                callId: callIdRef.current ?? pendingOfferRef.current?.callId,
                status: statusRef.current,
            });
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
                callWarn(
                    'CALL_START',
                    'accept requested without pending offer; hydrating',
                    {
                        callId,
                        status: statusRef.current,
                    },
                );
                setError('Восстанавливаем соединение звонка...');
                hydrateIncomingCall(callId).catch(hydrateError => {
                    logCallError('CALL_ERROR', 'hydrate after accept failed', {
                        callId,
                        error: describeCallError(hydrateError),
                    });
                });
            } else {
                callWarn(
                    'CALL_ERROR',
                    'accept requested without pending offer or call id',
                    {
                        status: statusRef.current,
                    },
                );
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
                callWarn(
                    'CALL_START',
                    'incoming call became stale after accept API',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            cancelIncomingCallNotification(pendingOffer.callId).catch(
                () => undefined,
            );
            const opened = await openLocalStreamWithFallback(
                pendingOffer.callType,
            );
            stream = opened.stream;
            setCurrentCallType(opened.callType);
            setDefaultSpeakerphoneForCallType(opened.callType);
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale after media open',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            callIdRef.current = pendingOffer.callId;
            pc = createPeerConnection(pendingOffer.fromId, pendingOffer.callId);
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale after peer connection',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            const pcId = getPeerConnectionId(pc);
            const activeStream = stream;
            const activePc = pc;
            callLog('CALL_WEBRTC', 'adding local tracks before answer', {
                callId: pendingOffer.callId,
                pcId,
                tracks: summarizeStreamTracks(activeStream),
            });
            logDev('[SocialMobile] Adding local tracks before createAnswer', {
                callId: pendingOffer.callId,
                pcId,
                tracks: summarizeStreamTracks(activeStream),
            });
            activeStream.getTracks().forEach(track => {
                callLog('CALL_WEBRTC', 'local track added for answer', {
                    callId: pendingOffer.callId,
                    pcId,
                    track: summarizeTrack(track),
                });
                logDev('[SocialMobile] addTrack(local)', {
                    callId: pendingOffer.callId,
                    pcId,
                    track: summarizeTrack(track),
                });
                activePc.addTrack(track, activeStream);
            });
            if (opened.callType === 'video') {
                applyVideoCodecPreferences(
                    activePc,
                    pendingOffer.callId,
                    pcId,
                );
            }
            await applyVideoSenderQuality(
                activePc,
                localVideoProfileRef.current,
                networkConnectedRef.current,
                pendingOffer.callId,
                pcId,
            );
            await applyAudioSenderQuality(
                activePc,
                networkConnectedRef.current,
                pendingOffer.callId,
                pcId,
            );

            callLog('CALL_WEBRTC', 'setting remote offer description', {
                callId: pendingOffer.callId,
                pcId,
                remoteDescription: summarizeSdp(pendingOffer.offer.sdp),
            });
            logDev('[SocialMobile] setRemoteDescription(offer) start', {
                callId: pendingOffer.callId,
                pcId,
                remoteDescription: summarizeSdp(pendingOffer.offer.sdp),
            });
            await activePc.setRemoteDescription(
                new RTCSessionDescription(pendingOffer.offer),
            );
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale after remote offer',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            logPeerState(
                activePc,
                pendingOffer.callId,
                'remote-offer-set',
                pcId,
            );
            await flushPendingIce();
            if (!isCurrentAccept()) {
                cleanupStaleAccept();
                return;
            }

            callLog('CALL_WEBRTC', 'creating call answer', {
                callId: pendingOffer.callId,
                pcId,
                callType: opened.callType,
            });
            const answerAudioProfile = await initialAudioQualityProfile(
                networkConnectedRef.current,
            );
            const answer = preferOpusInSessionDescription(
                sessionDescriptionForSignal(
                    (await activePc.createAnswer()) as CallSessionDescription,
                ),
                answerAudioProfile,
            );
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale after answer create',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            callLog('CALL_WEBRTC', 'call answer created', {
                callId: pendingOffer.callId,
                pcId,
                callType: opened.callType,
                audioProfile: answerAudioProfile,
                summary: summarizeSdp(answer.sdp),
            });
            logDev('[SocialMobile] createAnswer SDP summary', {
                callId: pendingOffer.callId,
                pcId,
                callType: opened.callType,
                audioProfile: answerAudioProfile,
                summary: summarizeSdp(answer.sdp),
            });
            if (!summarizeSdp(answer.sdp).hasOpus) {
                callWarn('CALL_WEBRTC', 'call answer SDP has no Opus codec', {
                    callId: pendingOffer.callId,
                    pcId,
                    audioCodecs: summarizeSdp(answer.sdp).audioCodecs,
                });
            }
            callLog('CALL_WEBRTC', 'setting local answer description', {
                callId: pendingOffer.callId,
                pcId,
            });
            await activePc.setLocalDescription(
                new RTCSessionDescription(answer),
            );
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale after local answer',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
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
            callLog('CALL_WEBRTC', 'local answer description set', {
                callId: pendingOffer.callId,
                pcId,
                signalingState: activePc.signalingState,
                localDescription: summarizeSdp(localAnswer.sdp),
            });
            callLog('CALL_WS', 'waiting for websocket before answer', {
                callId: pendingOffer.callId,
                toId: pendingOffer.fromId,
                timeoutMs: 8000,
            });
            const socketReady = await chatSocket.waitUntilConnected(8000);
            if (!isCurrentAccept()) {
                callWarn(
                    'CALL_START',
                    'incoming call became stale while waiting for socket',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        status: statusRef.current,
                    },
                );
                cleanupStaleAccept();
                return;
            }
            if (!socketReady) {
                logCallError(
                    'CALL_ERROR',
                    'websocket not connected before answer',
                    {
                        callId: pendingOffer.callId,
                        toId: pendingOffer.fromId,
                        timeoutMs: 8000,
                    },
                );
                throw new Error('WebSocket is not connected');
            }

            callLog('CALL_WS', 'sending call answer', {
                callId: pendingOffer.callId,
                pcId,
                toId: pendingOffer.fromId,
                callType: opened.callType,
                sdp: summarizeSdp(localAnswer.sdp),
            });
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
                logCallError('CALL_ERROR', 'call answer was not sent', {
                    callId: pendingOffer.callId,
                    pcId,
                    toId: pendingOffer.fromId,
                });
                throw new Error('WebSocket is not connected');
            }
            markCallSignalingReady(pendingOffer.callId, pendingOffer.fromId);
            pendingOfferRef.current = null;
            logDev(
                '[SocialMobile] Call answer sent; waiting for media connection',
                {
                    callId: pendingOffer.callId,
                    pcId,
                },
            );
            callLog('CALL_START', 'call answer sent', {
                callId: pendingOffer.callId,
                pcId,
                toId: pendingOffer.fromId,
            });
        } catch (callError) {
            if (!isCurrentAccept()) {
                logCallError(
                    'CALL_ERROR',
                    'accept call failed after stale state',
                    {
                        callId: pendingOffer.callId,
                        fromId: pendingOffer.fromId,
                        error: describeCallError(callError),
                    },
                );
                cleanupStaleAccept();
                return;
            }
            sendTerminalCallAction(
                'reject',
                pendingOffer.fromId,
                pendingOffer.callId,
            );
            const message = callErrorMessage(callError);
            logCallError('CALL_ERROR', 'accept call failed', {
                callId: pendingOffer.callId,
                fromId: pendingOffer.fromId,
                error: describeCallError(callError),
            });
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
        setDefaultSpeakerphoneForCallType,
        user?.id,
    ]);

    const rejectCall = useCallback(() => {
        const targetId =
            peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
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
            const targetId =
                peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
            const currentStatus = statusRef.current;
            if (!callId || !targetId || currentStatus === 'idle') {
                callWarn(
                    'CALL_START',
                    'call shutdown skipped terminal signaling',
                    {
                        callId: callId ?? null,
                        targetId: targetId ?? null,
                        currentStatus,
                    },
                );
                resetCall();
                return;
            }

            try {
                callLog('CALL_API', 'call shutdown terminal API started', {
                    callId,
                    targetId,
                    currentStatus,
                    action: currentStatus === 'incoming' ? 'reject' : 'end',
                });
                if (currentStatus === 'incoming') {
                    await callsApi.rejectCall(callId);
                } else {
                    await callsApi.endCall(callId);
                }
            } catch (shutdownError) {
                logCallError(
                    'CALL_ERROR',
                    'call shutdown terminal API failed',
                    {
                        callId,
                        targetId,
                        currentStatus,
                        error: describeCallError(shutdownError),
                    },
                );
                try {
                    await chatSocket.waitUntilConnected(1200);
                    if (currentStatus === 'incoming') {
                        chatSocket.sendCallReject(targetId, callId);
                    } else {
                        chatSocket.sendCallEnd(targetId, callId);
                    }
                } catch (sendError) {
                    logCallError(
                        'CALL_ERROR',
                        'call shutdown terminal WS fallback failed',
                        {
                            callId,
                            targetId,
                            currentStatus,
                            error: describeCallError(sendError),
                        },
                    );
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

    const toggleSpeakerphone = useCallback(() => {
        setSpeakerphoneOn(current => {
            const next = !current;
            speakerphoneOnRef.current = next;
            try {
                nativeCallAudioSession?.setSpeakerphoneOn?.(next);
            } catch (nativeError) {
                logCallError(
                    'CALL_ERROR',
                    'failed to toggle call speakerphone',
                    {
                        speakerphoneOn: next,
                        error: describeCallError(nativeError),
                    },
                );
                warnDev('[SocialMobile] Failed to toggle call speakerphone', {
                    speakerphoneOn: next,
                    error: nativeError,
                });
            }
            return next;
        });
    }, []);

    const switchCamera = useCallback(async () => {
        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        if (!videoTrack) {
            return;
        }

        const targetFacingMode = frontCamera ? 'environment' : 'user';
        const profile = localVideoProfileRef.current ?? videoQualityProfiles.high;
        try {
            await videoTrack.applyConstraints(
                videoConstraints(profile, targetFacingMode),
            );
            setFrontCamera(targetFacingMode === 'user');
            callLog('CALL_WEBRTC', 'camera switched with constraints', {
                callId: callIdRef.current,
                targetFacingMode,
                track: summarizeTrack(videoTrack),
            });
        } catch (switchError) {
            logCallError('CALL_ERROR', 'camera constraints switch failed', {
                callId: callIdRef.current,
                targetFacingMode,
                error: describeCallError(switchError),
            });
            try {
                videoTrack._switchCamera();
                setFrontCamera(current => !current);
            } catch (fallbackError) {
                logCallError('CALL_ERROR', 'camera fallback switch failed', {
                    callId: callIdRef.current,
                    error: describeCallError(fallbackError),
                });
                return;
            }
        }

        await applyVideoSenderQuality(
            pcRef.current,
            localVideoProfileRef.current,
            networkConnectedRef.current,
            callIdRef.current,
            getPeerConnectionId(pcRef.current),
        );
    }, [frontCamera, getPeerConnectionId]);

    const handleRenegotiationOffer = useCallback(
        (
            fromId: number,
            callId: string,
            offer: CallSessionDescription,
            incomingType?: CallType,
        ) => {
            const pc = pcRef.current;
            const currentPeerId = peerUserIdRef.current;
            const currentStatus = statusRef.current;
            const canRenegotiate =
                Boolean(pc) &&
                pcCallIdRef.current === callId &&
                callIdRef.current === callId &&
                currentPeerId === fromId &&
                currentStatus !== 'idle' &&
                currentStatus !== 'incoming' &&
                currentStatus !== 'ended' &&
                currentStatus !== 'error';

            if (!canRenegotiate || !pc) {
                return false;
            }

            const pcId = getPeerConnectionId(pc);
            if (pc.signalingState !== 'stable') {
                callWarn(
                    'CALL_WEBRTC',
                    'renegotiation offer ignored outside stable signaling',
                    {
                        callId,
                        pcId,
                        fromId,
                        signalingState: pc.signalingState,
                    },
                );
                return true;
            }

            callLog('CALL_WEBRTC', 'renegotiation offer received', {
                callId,
                pcId,
                fromId,
                incomingType: incomingType ?? null,
                offer: summarizeSdp(offer.sdp),
            });
            if (currentStatus === 'active') {
                setCallStatus('reconnecting', 'renegotiation_offer_received');
            }

            (async () => {
                try {
                    await pc.setRemoteDescription(
                        new RTCSessionDescription(offer),
                    );
                    if (
                        pcRef.current !== pc ||
                        callIdRef.current !== callId ||
                        pcCallIdRef.current !== callId
                    ) {
                        return;
                    }

                    logPeerState(pc, callId, 'renegotiation-offer-set', pcId);
                    await flushPendingIce();
                    await applyAudioSenderQuality(
                        pc,
                        networkConnectedRef.current,
                        callId,
                        pcId,
                    );
                    const audioProfile = await initialAudioQualityProfile(
                        networkConnectedRef.current,
                    );
                    const answer = preferOpusInSessionDescription(
                        sessionDescriptionForSignal(
                            (await pc.createAnswer()) as CallSessionDescription,
                        ),
                        audioProfile,
                    );
                    const answerSummary = summarizeSdp(answer.sdp);

                    callLog('CALL_WEBRTC', 'renegotiation answer created', {
                        callId,
                        pcId,
                        audioProfile,
                        summary: answerSummary,
                    });
                    if (!answerSummary.hasOpus) {
                        callWarn(
                            'CALL_WEBRTC',
                            'renegotiation answer has no Opus codec',
                            {
                                callId,
                                pcId,
                                audioCodecs: answerSummary.audioCodecs,
                            },
                        );
                    }

                    await pc.setLocalDescription(
                        new RTCSessionDescription(answer),
                    );
                    if (
                        pcRef.current !== pc ||
                        callIdRef.current !== callId ||
                        pcCallIdRef.current !== callId
                    ) {
                        return;
                    }

                    const localAnswer = sessionDescriptionForSignal(
                        pc.localDescription,
                        answer,
                    );
                    const sent = chatSocket.sendCallAnswer(
                        fromId,
                        localAnswer,
                        callId,
                    );
                    callLog('CALL_WS', 'renegotiation answer signaled', {
                        callId,
                        pcId,
                        fromId,
                        sent,
                        sdp: summarizeSdp(localAnswer.sdp),
                    });
                } catch (renegotiationError) {
                    logCallError(
                        'CALL_ERROR',
                        'failed to handle renegotiation offer',
                        {
                            callId,
                            pcId,
                            fromId,
                            error: describeCallError(renegotiationError),
                        },
                    );
                }
            })();

            return true;
        },
        [flushPendingIce, getPeerConnectionId, setCallStatus],
    );

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

            callLog('CALL_WS', 'call event received in context', {
                type: event.type,
                payload:
                    event.payload && typeof event.payload === 'object'
                        ? {
                              callId: (event.payload as { call_id?: unknown })
                                  .call_id,
                              fromId: (event.payload as { from_id?: unknown })
                                  .from_id,
                          }
                        : null,
                status: statusRef.current,
                currentCallId: callIdRef.current,
                peerUserId: peerUserIdRef.current,
            });

            const dedupKey = callEventDedupKey(event);
            if (dedupKey) {
                if (seenCallEventsRef.current.has(dedupKey)) {
                    callWarn(
                        'CALL_WS',
                        'duplicate call signaling event ignored',
                        {
                            type: event.type,
                            dedupKey,
                        },
                    );
                    logDev(
                        '[SocialMobile] Duplicate call signaling event ignored',
                        {
                            type: event.type,
                            dedupKey,
                        },
                    );
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
                    callWarn('CALL_WS', 'incoming call offer ignored', {
                        fromId,
                        currentUserId: user?.id ?? null,
                        callId,
                        reason:
                            fromId === user?.id
                                ? 'self_offer'
                                : 'missing_call_id',
                    });
                    return;
                }

                if (
                    handleRenegotiationOffer(
                        fromId,
                        callId,
                        offer,
                        incomingType,
                    )
                ) {
                    return;
                }

                if (statusRef.current !== 'idle') {
                    if (
                        statusRef.current === 'incoming' &&
                        callIdRef.current === callId
                    ) {
                        const nextCallType =
                            incomingType === 'video' ? 'video' : 'audio';
                        const matchingPushCall =
                            pendingIncomingCallPushRef.current?.callId ===
                            callId
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
                        setDefaultSpeakerphoneForCallType(nextCallType);
                        loadPeerName(
                            fromId,
                            matchingPushCall?.callerName,
                            callId,
                        ).catch(peerNameError => {
                            logCallError(
                                'CALL_ERROR',
                                'failed to load call peer name',
                                {
                                    callId,
                                    fromId,
                                    error: describeCallError(peerNameError),
                                },
                            );
                        });
                        return;
                    }

                    sendTerminalCallAction('reject', fromId, callId);
                    callWarn('CALL_WS', 'rejected incoming call while busy', {
                        callId,
                        fromId,
                        status: statusRef.current,
                    });
                    logDev('[SocialMobile] Rejected incoming call while busy', {
                        callId,
                        fromId,
                        status: statusRef.current,
                    });
                    return;
                }

                const nextCallType =
                    incomingType === 'video' ? 'video' : 'audio';
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
                setDefaultSpeakerphoneForCallType(nextCallType);
                setCallStatus('incoming');
                callLog('CALL_WS', 'incoming call offer accepted by context', {
                    callId,
                    fromId,
                    callType: nextCallType,
                });
                logDev('[SocialMobile] Incoming call offer received', {
                    callId,
                    fromId,
                    callType: nextCallType,
                });
                loadPeerName(
                    fromId,
                    matchingPushCall?.callerName,
                    callId,
                ).catch(peerNameError => {
                    logCallError(
                        'CALL_ERROR',
                        'failed to load call peer name',
                        {
                            callId,
                            fromId,
                            error: describeCallError(peerNameError),
                        },
                    );
                });
                return;
            }

            const payload = event.payload as {
                from_id: number;
                call_id?: string;
                answer?: CallSessionDescription;
                candidate?: CallIceCandidate;
            };

            if (
                !isCallId(payload.call_id) ||
                payload.call_id !== callIdRef.current
            ) {
                callWarn('CALL_WS', 'call event ignored for non-current call', {
                    type: event.type,
                    eventCallId: payload.call_id,
                    currentCallId: callIdRef.current,
                    fromId: payload.from_id,
                });
                if (
                    isCallId(payload.call_id) &&
                    (event.type === WS_EVENTS.CALL_END ||
                        event.type === WS_EVENTS.CALL_REJECT ||
                        event.type === WS_EVENTS.CALL_TIMEOUT ||
                        event.type === WS_EVENTS.CALL_BUSY ||
                        event.type === WS_EVENTS.CALL_REPLACED)
                ) {
                    rememberTerminalIncomingCall(payload.call_id).catch(
                        () => undefined,
                    );
                    chatSocket.discardPendingCallEvents(payload.call_id);
                }
                return;
            }

            if (payload.from_id === user?.id) {
                callWarn('CALL_WS', 'call event ignored from current user', {
                    type: event.type,
                    callId: payload.call_id,
                    fromId: payload.from_id,
                });
                if (!pcRef.current || statusRef.current === 'incoming') {
                    finishCall('ended');
                }
                return;
            }

            const currentPeerId =
                peerUserIdRef.current ?? pendingOfferRef.current?.fromId;
            if (payload.from_id !== currentPeerId) {
                callWarn('CALL_WS', 'call event ignored from unexpected peer', {
                    type: event.type,
                    callId: payload.call_id,
                    fromId: payload.from_id,
                    currentPeerId,
                });
                return;
            }

            if (event.type === WS_EVENTS.CALL_ANSWER) {
                const pc = pcRef.current;
                if (!payload.answer || !pc) {
                    logCallError(
                        'CALL_ERROR',
                        'call answer ignored without active PC',
                        {
                            callId: payload.call_id,
                            fromId: payload.from_id,
                            hasAnswer: Boolean(payload.answer),
                            hasPeerConnection: Boolean(pc),
                        },
                    );
                    warnDev(
                        '[SocialMobile] Call answer ignored without active PC',
                        {
                            callId: payload.call_id,
                            fromId: payload.from_id,
                            hasAnswer: Boolean(payload.answer),
                        },
                    );
                    return;
                }
                const pcId = getPeerConnectionId(pc);
                const offerPeer = localOfferPeerRef.current;
                if (pcCallIdRef.current !== payload.call_id) {
                    logCallError(
                        'CALL_ERROR',
                        'call answer ignored for non-current PC',
                        {
                            callId: payload.call_id,
                            pcCallId: pcCallIdRef.current,
                            pcId,
                        },
                    );
                    warnDev(
                        '[SocialMobile] Call answer ignored for non-current PC',
                        {
                            callId: payload.call_id,
                            pcCallId: pcCallIdRef.current,
                            pcId,
                        },
                    );
                    return;
                }
                if (
                    offerPeer?.callId === payload.call_id &&
                    offerPeer.pcId !== (pcId ?? -1)
                ) {
                    logCallError(
                        'CALL_ERROR',
                        'call answer ignored because offer PC changed',
                        {
                            callId: payload.call_id,
                            offerPcId: offerPeer.pcId,
                            currentPcId: pcId,
                        },
                    );
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

                callLog('CALL_WS', 'call answer received', {
                    callId: payload.call_id,
                    pcId,
                    fromId: payload.from_id,
                    answer: summarizeSdp(payload.answer.sdp),
                });
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
                pc.setRemoteDescription(
                    new RTCSessionDescription(payload.answer),
                )
                    .then(async () => {
                        if (
                            pcRef.current !== pc ||
                            callIdRef.current !== callId
                        ) {
                            return;
                        }
                        logPeerState(pc, callId, 'remote-answer-set', pcId);
                        await flushPendingIce();
                        if (
                            pcRef.current !== pc ||
                            callIdRef.current !== callId
                        ) {
                            return;
                        }
                        if (statusRef.current !== 'active') {
                            setCallStatus(
                                'connecting',
                                'answer_set_waiting_for_media',
                            );
                        }
                    })
                    .catch(callError => {
                        if (
                            pcRef.current !== pc ||
                            callIdRef.current !== callId
                        ) {
                            return;
                        }
                        const message = callErrorMessage(callError);
                        logCallError(
                            'CALL_ERROR',
                            'failed to set remote answer',
                            {
                                callId,
                                pcId,
                                error: describeCallError(callError),
                            },
                        );
                        showCallError(message);
                        finishCall('error', message, true);
                    });
                return;
            }

            if (event.type === WS_EVENTS.CALL_ICE) {
                const candidate = payload.candidate;
                if (!isUsableIceCandidate(candidate)) {
                    callWarn(
                        'CALL_WEBRTC',
                        'skipping empty incoming ICE candidate',
                        {
                            callId: payload.call_id,
                            pcId: getPeerConnectionId(pcRef.current),
                            fromId: payload.from_id,
                        },
                    );
                    logDev(
                        '[SocialMobile] Skipping empty incoming ICE candidate',
                        {
                            callId: payload.call_id,
                            pcId: getPeerConnectionId(pcRef.current),
                            fromId: payload.from_id,
                        },
                    );
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
                    callLog(
                        'CALL_WEBRTC',
                        'duplicate incoming ICE candidate ignored',
                        {
                            callId: payload.call_id,
                            pcId: getPeerConnectionId(pcRef.current),
                            fromId: payload.from_id,
                            type: iceCandidateType(remoteCandidate),
                        },
                    );
                    logDev(
                        '[SocialMobile] Duplicate incoming ICE candidate ignored',
                        {
                            callId: payload.call_id,
                            pcId: getPeerConnectionId(pcRef.current),
                            fromId: payload.from_id,
                            type: iceCandidateType(remoteCandidate),
                        },
                    );
                    return;
                }

                const pc = pcRef.current;
                const pcId = getPeerConnectionId(pc);
                if (pc && pcCallIdRef.current !== payload.call_id) {
                    logCallError(
                        'CALL_ERROR',
                        'incoming ICE ignored for non-current PC',
                        {
                            callId: payload.call_id,
                            pcCallId: pcCallIdRef.current,
                            pcId,
                            fromId: payload.from_id,
                            type: iceCandidateType(candidate),
                        },
                    );
                    warnDev(
                        '[SocialMobile] Incoming ICE ignored for non-current PC',
                        {
                            callId: payload.call_id,
                            pcCallId: pcCallIdRef.current,
                            pcId,
                            fromId: payload.from_id,
                            type: iceCandidateType(candidate),
                        },
                    );
                    return;
                }
                if (!pc?.remoteDescription) {
                    queuePendingIceCandidate(
                        remoteCandidate,
                        payload.from_id,
                        'live',
                    );
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
                    .catch(iceError => {
                        logCallError(
                            'CALL_ERROR',
                            'failed to add live ICE candidate',
                            {
                                callId: payload.call_id,
                                pcId,
                                fromId: payload.from_id,
                                error: describeCallError(iceError),
                            },
                        );
                    });
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
                callLog('CALL_WS', 'server terminal call event received', {
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
                callLog('CALL_WS', 'remote call ended or rejected', {
                    callId: payload.call_id,
                    fromId: payload.from_id,
                    eventType: event.type,
                    status: statusRef.current,
                });
                finishCall('ended');
            }
        },
        [
            finishCall,
            flushPendingIce,
            getPeerConnectionId,
            handleRenegotiationOffer,
            loadPeerName,
            queuePendingIceCandidate,
            sendTerminalCallAction,
            setCallPeer,
            setCallStatus,
            setCurrentCallType,
            setDefaultSpeakerphoneForCallType,
            user?.id,
        ],
    );

    useEffect(() => {
        if (!user?.id) {
            resetCall();
            return undefined;
        }

        const unsubscribe = chatSocket.onMessage(handleSocketEvent);
        return () => {
            unsubscribe();
        };
    }, [handleSocketEvent, resetCall, user?.id]);

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        let mounted = true;
        hydrateIncomingCall().catch(hydrateError => {
            logCallError('CALL_ERROR', 'initial active call hydrate failed', {
                error: describeCallError(hydrateError),
            });
        });
        consumePendingIncomingCall()
            .then(call => {
                if (mounted && call) {
                    stagePendingIncomingCallPush(call);
                }
            })
            .catch(pendingCallError => {
                logCallError(
                    'CALL_ERROR',
                    'consume pending incoming call failed',
                    {
                        error: describeCallError(pendingCallError),
                    },
                );
            });

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
                logDev(
                    '[SocialMobile] WebSocket connected; restoring active call',
                    {
                        callId: callIdRef.current,
                        pcId: getPeerConnectionId(pcRef.current),
                        status: statusRef.current,
                    },
                );
                callLog(
                    'CALL_WS',
                    'websocket connected; restoring active call',
                    {
                        callId: callIdRef.current,
                        pcId: getPeerConnectionId(pcRef.current),
                        status: statusRef.current,
                    },
                );
                hydrateIncomingCall().catch(hydrateError => {
                    logCallError(
                        'CALL_ERROR',
                        'active call hydrate after websocket connect failed',
                        {
                            callId: callIdRef.current,
                            error: describeCallError(hydrateError),
                        },
                    );
                });
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
        const heartbeatTimer = setInterval(
            sendHeartbeat,
            callHeartbeatIntervalMs,
        );
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
                    for (const fallbackProfile of videoProfileFallbackChain(
                        profile,
                    )) {
                        if (fallbackProfile.name === 'low') {
                            return;
                        }
                        const applied = await applyLocalVideoProfile(
                            fallbackProfile,
                        );
                        if (applied) {
                            return;
                        }
                    }
                })
                .catch(qualityError => {
                    logCallError('CALL_ERROR', 'video quality upgrade failed', {
                        callId: callIdRef.current,
                        error: describeCallError(qualityError),
                    });
                });
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

        applyLocalVideoProfile(videoQualityProfiles.low).catch(degradeError => {
            logCallError(
                'CALL_ERROR',
                'failed to degrade video while offline',
                {
                    callId: callIdRef.current,
                    error: describeCallError(degradeError),
                },
            );
        });
    }, [applyLocalVideoProfile, callType, networkConnected, status]);

    useEffect(() => {
        if (
            Platform.OS !== 'android' ||
            appState === 'active' ||
            callTypeRef.current !== 'video' ||
            (statusRef.current !== 'active' &&
                statusRef.current !== 'reconnecting')
        ) {
            return;
        }

        try {
            NativeModules.CallPiP?.enterPiP?.();
            logDev('[SocialMobile] Requested Android picture-in-picture', {
                callId: callIdRef.current,
                appState,
            });
        } catch (pipError) {
            warnDev('[SocialMobile] Failed to enter Android picture-in-picture', {
                callId: callIdRef.current,
                appState,
                error: pipError,
            });
        }
    }, [appState]);

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
                speakerphoneOn={speakerphoneOn}
                frontCamera={frontCamera}
                error={error}
                diagnostics={__DEV__ ? diagnostics : null}
                onAccept={acceptCall}
                onReject={rejectCall}
                onEnd={endCall}
                onToggleMicrophone={toggleMicrophone}
                onToggleCamera={toggleCamera}
                onToggleSpeakerphone={toggleSpeakerphone}
                onSwitchCamera={switchCamera}
            />
        </CallContext.Provider>
    );
}

export function useCall() {
    const value = useContext(CallContext);
    if (!value) {
        throw new Error('useCall must be used inside CallProvider');
    }
    return value;
}
