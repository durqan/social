export const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};

export const videoConstraints: MediaTrackConstraints = {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',
};

export const videoSenderParams: RTCRtpEncodingParameters = {
    maxBitrate: 1_800_000,
    maxFramerate: 30,
    priority: 'high',
    networkPriority: 'high',
};

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

export const rtcConfig: RTCConfiguration = {
    iceServers: buildIceServers(),
};

export const getCallErrorMessage = (error: unknown, fallback: string) => {
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
