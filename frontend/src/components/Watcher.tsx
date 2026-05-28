import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext.js';
import {
    watcherService,
    type WatcherRoom,
    type WatcherWSMessage,
} from '../services/watcherService.js';
import { Icon } from './ui/Icon.js';
import { Spinner } from './ui/Spinner.js';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

type WatcherChatMessage = {
    id: string;
    author: string;
    text: string;
    createdAt: string;
};

const randomID = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function formatClock(value: string) {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseChatMessage(text?: string): WatcherChatMessage | null {
    if (!text) {
        return null;
    }

    try {
        const parsed = JSON.parse(text) as Partial<WatcherChatMessage>;
        if (typeof parsed.text === 'string' && parsed.text.trim()) {
            return {
                id: parsed.id || randomID(),
                author: parsed.author || 'Пользователь',
                text: parsed.text,
                createdAt: parsed.createdAt || new Date().toISOString(),
            };
        }
    } catch {
        return {
            id: randomID(),
            author: 'Пользователь',
            text,
            createdAt: new Date().toISOString(),
        };
    }

    return null;
}

function connectionLabel(status: ConnectionStatus) {
    switch (status) {
        case 'connected':
            return 'Подключено';
        case 'connecting':
            return 'Подключение';
        case 'disconnected':
            return 'Отключено';
        default:
            return 'Нет комнаты';
    }
}

function Watcher() {
    const { currentUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const roomIDFromURL = searchParams.get('room') || '';
    const [videoURL, setVideoURL] = useState('');
    const [joinRoomID, setJoinRoomID] = useState(roomIDFromURL);
    const [room, setRoom] = useState<WatcherRoom | null>(null);
    const [roomLoading, setRoomLoading] = useState(false);
    const [roomError, setRoomError] = useState('');
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
    const [clientCount, setClientCount] = useState(0);
    const [chatText, setChatText] = useState('');
    const [messages, setMessages] = useState<WatcherChatMessage[]>([]);
    const videoRef = useRef<HTMLVideoElement>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const applyingRemoteRef = useRef(false);

    const inviteURL = useMemo(() => {
        if (!room) {
            return '';
        }

        const url = new URL(window.location.href);
        url.searchParams.set('room', room.id);
        return url.toString();
    }, [room]);

    const sendWSMessage = useCallback((message: WatcherWSMessage) => {
        if (socketRef.current?.readyState !== WebSocket.OPEN) {
            return false;
        }

        socketRef.current.send(JSON.stringify(message));
        return true;
    }, []);

    const applyRemoteVideoState = useCallback((message: WatcherWSMessage) => {
        const video = videoRef.current;
        if (!video) {
            return;
        }

        applyingRemoteRef.current = true;

        if (typeof message.time === 'number' && Math.abs(video.currentTime - message.time) > 0.6) {
            video.currentTime = message.time;
        }

        if (message.type === 'play' || (message.type === 'sync' && message.paused === false)) {
            video.play().catch(() => undefined);
        }
        if (message.type === 'pause' || (message.type === 'sync' && message.paused !== false)) {
            video.pause();
        }

        window.setTimeout(() => {
            applyingRemoteRef.current = false;
        }, 300);
    }, []);

    const loadRoom = useCallback(async (roomID: string) => {
        const normalizedID = roomID.trim();
        if (!normalizedID) {
            return;
        }

        setRoomLoading(true);
        setRoomError('');

        try {
            const nextRoom = await watcherService.getRoom(normalizedID);
            setRoom(nextRoom);
            setJoinRoomID(nextRoom.id);
            setMessages([]);
        } catch (error) {
            setRoom(null);
            setRoomError(error instanceof Error ? error.message : 'Комната не найдена');
        } finally {
            setRoomLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!roomIDFromURL || roomIDFromURL === room?.id) {
            return;
        }

        void loadRoom(roomIDFromURL);
    }, [loadRoom, room?.id, roomIDFromURL]);

    useEffect(() => {
        if (!room) {
            setConnectionStatus('idle');
            setClientCount(0);
            return;
        }

        let cancelled = false;

        const refreshStatus = () => {
            watcherService.getRoomStatus(room.id)
                .then(status => {
                    if (!cancelled) {
                        setClientCount(status.client_count);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setClientCount(0);
                    }
                });
        };

        refreshStatus();
        const timer = window.setInterval(refreshStatus, 5000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [room]);

    useEffect(() => {
        if (!room) {
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        setConnectionStatus('connecting');
        const socket = new WebSocket(watcherService.webSocketURL(room.id));
        socketRef.current = socket;

        socket.onopen = () => {
            setConnectionStatus('connected');
        };

        socket.onmessage = event => {
            try {
                const message = JSON.parse(event.data) as WatcherWSMessage;

                if (message.type === 'message') {
                    const chatMessage = parseChatMessage(message.text);
                    if (chatMessage) {
                        setMessages(prev => [...prev, chatMessage]);
                    }
                    return;
                }

                applyRemoteVideoState(message);
            } catch (error) {
                console.error('Ошибка watcher-сообщения:', error);
            }
        };

        socket.onclose = () => {
            if (socketRef.current === socket) {
                setConnectionStatus('disconnected');
                socketRef.current = null;
            }
        };

        socket.onerror = () => {
            setConnectionStatus('disconnected');
        };

        return () => {
            if (socketRef.current === socket) {
                socketRef.current = null;
            }
            socket.close();
        };
    }, [applyRemoteVideoState, room]);

    const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const normalizedURL = videoURL.trim();
        if (!normalizedURL) {
            setRoomError('Укажите ссылку на видео');
            return;
        }

        setRoomLoading(true);
        setRoomError('');

        try {
            const nextRoom = await watcherService.createRoom(normalizedURL);
            setRoom(nextRoom);
            setJoinRoomID(nextRoom.id);
            setMessages([]);
            setSearchParams({ room: nextRoom.id });
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : 'Не удалось создать комнату');
        } finally {
            setRoomLoading(false);
        }
    };

    const handleJoinRoom = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const normalizedID = joinRoomID.trim();
        if (!normalizedID) {
            setRoomError('Укажите ID комнаты');
            return;
        }

        setSearchParams({ room: normalizedID });
        void loadRoom(normalizedID);
    };

    const handleCopyInvite = async () => {
        if (!inviteURL) {
            return;
        }

        try {
            await navigator.clipboard.writeText(inviteURL);
        } catch {
            setRoomError('Не удалось скопировать ссылку');
        }
    };

    const sendPlaybackState = (type: 'play' | 'pause' | 'seek') => {
        if (applyingRemoteRef.current) {
            return;
        }

        const video = videoRef.current;
        if (!video) {
            return;
        }

        sendWSMessage({
            type,
            time: video.currentTime,
            paused: video.paused,
        });
    };

    const handleSendChat = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const normalizedText = chatText.trim();
        if (!normalizedText) {
            return;
        }

        const payload: WatcherChatMessage = {
            id: randomID(),
            author: currentUser?.name || 'Пользователь',
            text: normalizedText,
            createdAt: new Date().toISOString(),
        };

        if (sendWSMessage({ type: 'message', text: JSON.stringify(payload) })) {
            setChatText('');
        } else {
            setRoomError('Чат недоступен: нет подключения к комнате');
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="app-card overflow-hidden">
                    <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-semibold text-gray-950">Совместный просмотр</h2>
                                <p className="text-sm text-gray-500">{connectionLabel(connectionStatus)} · {clientCount} онлайн</p>
                            </div>
                            {room && (
                                <button
                                    type="button"
                                    onClick={handleCopyInvite}
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                >
                                    Скопировать ссылку
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="bg-black">
                        {room ? (
                            <video
                                ref={videoRef}
                                src={room.video_url}
                                controls
                                playsInline
                                className="aspect-video w-full bg-black"
                                onPlay={() => sendPlaybackState('play')}
                                onPause={() => sendPlaybackState('pause')}
                                onSeeked={() => sendPlaybackState('seek')}
                            />
                        ) : (
                            <div className="flex aspect-video items-center justify-center bg-gray-950 text-sm text-gray-300">
                                Комната не выбрана
                            </div>
                        )}
                    </div>

                    {room && (
                        <div className="grid gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-600 sm:grid-cols-[1fr_auto] sm:px-5">
                            <div className="min-w-0">
                                <span className="font-semibold text-gray-800">ID комнаты: </span>
                                <span className="break-all">{room.id}</span>
                            </div>
                            <a
                                href={room.video_url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-sky-600 hover:underline"
                            >
                                Открыть видео
                            </a>
                        </div>
                    )}
                </div>

                <aside className="app-card flex min-h-[420px] flex-col overflow-hidden">
                    <div className="border-b border-gray-100 px-4 py-3">
                        <h2 className="text-base font-semibold text-gray-950">Чат комнаты</h2>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                        {messages.length === 0 ? (
                            <div className="flex h-full min-h-52 items-center justify-center text-center text-sm text-gray-500">
                                Сообщений пока нет
                            </div>
                        ) : (
                            messages.map(message => (
                                <div key={message.id} className="rounded-xl bg-gray-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-semibold text-gray-900">{message.author}</span>
                                        <span className="flex-shrink-0 text-xs text-gray-400">{formatClock(message.createdAt)}</span>
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{message.text}</p>
                                </div>
                            ))
                        )}
                    </div>

                    <form onSubmit={handleSendChat} className="border-t border-gray-100 p-3">
                        <div className="flex gap-2">
                            <input
                                value={chatText}
                                onChange={event => setChatText(event.target.value)}
                                disabled={!room || connectionStatus !== 'connected'}
                                className="app-input h-10 px-3 text-sm disabled:opacity-60"
                                placeholder="Сообщение"
                            />
                            <button
                                type="submit"
                                disabled={!room || connectionStatus !== 'connected' || !chatText.trim()}
                                className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white transition hover:bg-sky-700 disabled:opacity-50"
                                title="Отправить"
                            >
                                <Icon name="send" className="h-5 w-5" />
                            </button>
                        </div>
                    </form>
                </aside>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
                <form onSubmit={handleCreateRoom} className="app-card p-4 sm:p-5">
                    <h2 className="text-base font-semibold text-gray-950">Новая комната</h2>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                            value={videoURL}
                            onChange={event => setVideoURL(event.target.value)}
                            className="app-input h-11 px-3"
                            placeholder="https://example.com/video.mp4"
                        />
                        <button
                            type="submit"
                            disabled={roomLoading}
                            className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
                        >
                            Создать
                        </button>
                    </div>
                </form>

                <form onSubmit={handleJoinRoom} className="app-card p-4 sm:p-5">
                    <h2 className="text-base font-semibold text-gray-950">Войти в комнату</h2>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                            value={joinRoomID}
                            onChange={event => setJoinRoomID(event.target.value)}
                            className="app-input h-11 px-3"
                            placeholder="ID комнаты"
                        />
                        <button
                            type="submit"
                            disabled={roomLoading}
                            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                            Войти
                        </button>
                    </div>
                </form>
            </section>

            {(roomLoading || roomError) && (
                <div className={`app-card flex items-center gap-3 px-4 py-3 text-sm ${roomError ? 'text-red-600' : 'text-gray-600'}`}>
                    {roomLoading && <Spinner size="sm" />}
                    <span>{roomError || 'Загрузка комнаты...'}</span>
                </div>
            )}
        </div>
    );
}

export default Watcher;
