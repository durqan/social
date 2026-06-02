import {
    audioConstraints,
    rtcConfig,
    videoConstraints,
    videoSenderParams,
} from "@/features/call/lib/callConfig.js";

import type { WebSocketService } from "@/shared/api/ws.js";
import type { CallType } from "@/features/call/types.js";

export type CameraFacingMode = 'user' | 'environment';

type LocalCallStreamResult = {
    stream: MediaStream;
    callType: CallType;
    warning: string | null;
};

type PeerConnectionOptions = {
    toId: number;
    callId: string;
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
    callId,
    wsService,
    onRemoteStream,
    onConnectionStateChange,
}: PeerConnectionOptions) {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = event => {
        if (event.candidate) {
            wsService.sendCallIce(toId, event.candidate.toJSON(), callId);
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

export function closePeerConnection(pc: RTCPeerConnection | null) {
    if (!pc) {
        return;
    }

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
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

export async function countVideoInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        return 0;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput').length;
}

export async function openReplacementVideoTrack(
    stream: MediaStream,
    facingMode: CameraFacingMode,
) {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не поддерживает доступ к камере');
    }

    const devices = navigator.mediaDevices.enumerateDevices
        ? await navigator.mediaDevices.enumerateDevices()
        : [];
    const videoInputs = devices.filter(device => device.kind === 'videoinput');
    const currentDeviceID = stream.getVideoTracks()[0]?.getSettings().deviceId;
    const currentIndex = videoInputs.findIndex(device => device.deviceId === currentDeviceID);
    const nextDevice = currentIndex >= 0
        ? videoInputs[(currentIndex + 1) % videoInputs.length]
        : videoInputs[0];

    const constraints: MediaTrackConstraints = { ...videoConstraints };

    if (isMobileDevice()) {
        constraints.facingMode = { ideal: facingMode };
        delete constraints.deviceId;
    } else if (nextDevice?.deviceId) {
        constraints.deviceId = { exact: nextDevice.deviceId };
        delete constraints.facingMode;
    } else {
        constraints.facingMode = { ideal: facingMode };
        delete constraints.deviceId;
    }

    const replacementStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: constraints,
    });
    const [track] = replacementStream.getVideoTracks();

    if (!track) {
        stopMediaStream(replacementStream);
        throw new Error('Камера не найдена');
    }

    return track;
}

export async function replaceVideoSenderTrack(
    pc: RTCPeerConnection | null,
    stream: MediaStream,
    newTrack: MediaStreamTrack,
) {
    const sender = pc?.getSenders().find(item => item.track?.kind === 'video');

    if (!sender) {
        newTrack.stop();
        throw new Error('Видео дорожка звонка не найдена');
    }

    const [oldTrack] = stream.getVideoTracks();
    await sender.replaceTrack(newTrack);

    if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
    }

    stream.addTrack(newTrack);
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

function isMobileDevice() {
    return window.matchMedia('(pointer: coarse)').matches ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
