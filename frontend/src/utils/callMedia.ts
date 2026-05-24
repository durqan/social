import {
    audioConstraints,
    rtcConfig,
    videoConstraints,
    videoSenderParams,
} from '../services/callConfig.js';

import type { WebSocketService } from '../services/ws.js';
import type { CallType } from '../types/call.js';

type LocalCallStreamResult = {
    stream: MediaStream;
    callType: CallType;
    warning: string | null;
};

type PeerConnectionOptions = {
    toId: number;
    wsService: WebSocketService;
    onRemoteStream: (stream: MediaStream) => void;
    onConnectionStateChange: (state: RTCPeerConnectionState) => void;
};

export async function openLocalCallStream(callType: CallType): Promise<LocalCallStreamResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не поддерживает доступ к камере и микрофону');
    }

    try {
        return {
            stream: await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
                video: callType === 'video' ? videoConstraints : false,
            }),
            callType,
            warning: null,
        };
    } catch (error) {
        if (callType !== 'video') {
            throw error;
        }

        console.warn('Video input failed, falling back to audio-only call:', error);

        return {
            stream: await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
                video: false,
            }),
            callType: 'audio',
            warning: 'Камера недоступна, звонок продолжен без видео',
        };
    }
}

export function createCallPeerConnection({
    toId,
    wsService,
    onRemoteStream,
    onConnectionStateChange,
}: PeerConnectionOptions) {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = event => {
        if (event.candidate) {
            wsService.sendCallIce(toId, event.candidate.toJSON());
        }
    };

    pc.ontrack = event => {
        const [remoteStream] = event.streams;

        if (remoteStream) {
            onRemoteStream(remoteStream);
        }
    };

    pc.onconnectionstatechange = () => {
        console.info('Call connection state:', pc.connectionState);
        onConnectionStateChange(pc.connectionState);
    };

    return pc;
}

export async function applyVideoSenderQuality(pc: RTCPeerConnection) {
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
    } catch (error) {
        console.warn('Failed to apply video sender quality:', error);
    }
}

export function addStreamTracks(pc: RTCPeerConnection, stream: MediaStream) {
    stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
    });
}

export async function addIceCandidates(
    pc: RTCPeerConnection,
    candidates: RTCIceCandidateInit[],
    logMessage: string,
) {
    for (const candidate of candidates) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.warn(logMessage, error);
        }
    }
}

export function attachMediaStream(
    element: HTMLMediaElement | null,
    stream: MediaStream | null,
) {
    if (!element || !stream) {
        return;
    }

    element.srcObject = stream;
    element.play().catch(() => undefined);
}

export function detachMediaElement(element: HTMLMediaElement | null) {
    if (element) {
        element.srcObject = null;
    }
}

export function stopMediaStream(stream: MediaStream | null) {
    stream?.getTracks().forEach(track => track.stop());
}
