const watcherApiBaseURL = (import.meta.env.VITE_WATCHER_API_BASE_URL || '/watcher-api').replace(/\/$/, '');
const watcherWSBaseURL = import.meta.env.VITE_WATCHER_WS_BASE_URL;

export type WatcherRoom = {
    id: string;
    video_url: string;
};

export type WatcherRoomStatus = {
    client_count: number;
};

export type WatcherMessageType = 'message' | 'play' | 'pause' | 'seek' | 'sync';

export type WatcherWSMessage = {
    type: WatcherMessageType;
    time?: number;
    text?: string;
    paused?: boolean;
};

type CreateRoomResponse = {
    room_id: string;
    video_url: string;
};

async function watcherRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${watcherApiBaseURL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || 'Watcher request failed');
    }

    return response.json() as Promise<T>;
}

export const watcherService = {
    async createRoom(videoURL: string): Promise<WatcherRoom> {
        const response = await watcherRequest<CreateRoomResponse>('/rooms', {
            method: 'POST',
            body: JSON.stringify({ video_url: videoURL }),
        });

        return {
            id: response.room_id,
            video_url: response.video_url,
        };
    },

    getRoom(roomID: string) {
        return watcherRequest<WatcherRoom>(`/rooms/${encodeURIComponent(roomID)}`);
    },

    getRoomStatus(roomID: string) {
        return watcherRequest<WatcherRoomStatus>(`/rooms/${encodeURIComponent(roomID)}/status`);
    },

    webSocketURL(roomID: string) {
        if (watcherWSBaseURL) {
            return `${watcherWSBaseURL.replace(/\/$/, '')}/${encodeURIComponent(roomID)}`;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/watcher-ws/${encodeURIComponent(roomID)}`;
    },
};
