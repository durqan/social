import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useAuth } from "@/app/providers/AuthContext.js";

type PetMode = 'idle' | 'walking' | 'dragged' | 'sleeping' | 'happy';

type PetPosition = {
    x: number;
    y: number;
};

type MockMessage = {
    id: number;
    author: 'pet' | 'user';
    text: string;
};

const POSITION_KEY = 'aiPetCompanion.position';
const VISIBLE_KEY = 'aiPetCompanion.visible';
const PET_SIZE = 64;
const EDGE_PADDING = 16;

const modeView: Record<PetMode, { emoji: string; phrase: string; className: string }> = {
    idle: {
        emoji: '🐾',
        phrase: 'я тут',
        className: 'scale-100',
    },
    walking: {
        emoji: '🐕',
        phrase: 'пойдем смотреть ленту?',
        className: 'scale-105 rotate-3',
    },
    dragged: {
        emoji: '😮',
        phrase: 'держусь!',
        className: 'scale-110 -rotate-3',
    },
    sleeping: {
        emoji: '😴',
        phrase: 'я устал, посплю',
        className: 'scale-95 opacity-90',
    },
    happy: {
        emoji: '😊',
        phrase: 'приятно поболтать',
        className: 'scale-110',
    },
};

const randomPhrases = [
    'я тут',
    'пойдем смотреть ленту?',
    'новых сообщений нет?',
    'я устал, посплю',
    'потяни меня, если скучно',
];

const mockReplies = [
    'Я пока без настоящего AI, но рядом.',
    'Могу плавать по экрану и не мешать.',
    'Если скучно, потяни меня за лапу.',
    'Проверим сообщения?',
];

function clampPosition(position: PetPosition): PetPosition {
    if (typeof window === 'undefined') {
        return position;
    }

    return {
        x: Math.min(Math.max(EDGE_PADDING, position.x), window.innerWidth - PET_SIZE - EDGE_PADDING),
        y: Math.min(Math.max(EDGE_PADDING, position.y), window.innerHeight - PET_SIZE - EDGE_PADDING),
    };
}

function defaultPosition(): PetPosition {
    if (typeof window === 'undefined') {
        return { x: 24, y: 420 };
    }

    return {
        x: Math.max(EDGE_PADDING, window.innerWidth - PET_SIZE - 24),
        y: Math.max(EDGE_PADDING, window.innerHeight - PET_SIZE - 96),
    };
}

function readStoredPosition(): PetPosition {
    if (typeof window === 'undefined') {
        return defaultPosition();
    }

    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) {
        return defaultPosition();
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PetPosition>;
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return clampPosition({ x: parsed.x, y: parsed.y });
        }
    } catch {
        window.localStorage.removeItem(POSITION_KEY);
    }

    return defaultPosition();
}

function readStoredVisible(): boolean {
    if (typeof window === 'undefined') {
        return true;
    }

    return window.localStorage.getItem(VISIBLE_KEY) !== 'false';
}

export function PetCompanion() {
    const { currentUser, loading } = useAuth();
    const [position, setPosition] = useState<PetPosition>(() => readStoredPosition());
    const [visible, setVisible] = useState(() => readStoredVisible());
    const [mode, setMode] = useState<PetMode>('idle');
    const [chatOpen, setChatOpen] = useState(false);
    const [bubbleText, setBubbleText] = useState(modeView.idle.phrase);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<MockMessage[]>([
        { id: 1, author: 'pet', text: 'Привет, я Бублик. Пока я просто mock-питомец.' },
    ]);

    const dragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
        moved: boolean;
    } | null>(null);
    const movedRecentlyRef = useRef(false);
    const modeTimeoutRef = useRef<number | null>(null);
    const messageIdRef = useRef(2);
    const positionRef = useRef(position);

    const view = modeView[mode];

    useEffect(() => {
        positionRef.current = position;
    }, [position]);

    const savePosition = useCallback((nextPosition: PetPosition) => {
        const clamped = clampPosition(nextPosition);
        setPosition(clamped);
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(clamped));
    }, []);

    const setTemporaryMode = useCallback((nextMode: PetMode, duration = 2400) => {
        setMode(nextMode);
        setBubbleText(modeView[nextMode].phrase);

        if (modeTimeoutRef.current) {
            window.clearTimeout(modeTimeoutRef.current);
        }

        modeTimeoutRef.current = window.setTimeout(() => {
            setMode('idle');
            setBubbleText(modeView.idle.phrase);
        }, duration);
    }, []);

    useEffect(() => {
        if (!visible) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (dragRef.current || chatOpen) {
                return;
            }

            const nextMode: PetMode = Math.random() > 0.78 ? 'sleeping' : 'walking';
            const nextPhrase = randomPhrases[Math.floor(Math.random() * randomPhrases.length)] ?? modeView.idle.phrase;
            const nextPosition = clampPosition({
                x: position.x + Math.round(Math.random() * 72 - 36),
                y: position.y + Math.round(Math.random() * 56 - 28),
            });

            setPosition(nextPosition);
            window.localStorage.setItem(POSITION_KEY, JSON.stringify(nextPosition));
            setMode(nextMode);
            setBubbleText(nextPhrase);

            if (modeTimeoutRef.current) {
                window.clearTimeout(modeTimeoutRef.current);
            }

            modeTimeoutRef.current = window.setTimeout(() => {
                setMode('idle');
                setBubbleText(modeView.idle.phrase);
            }, 3500);
        }, 14000);

        return () => window.clearInterval(intervalId);
    }, [chatOpen, position.x, position.y, visible]);

    useEffect(() => {
        const handleResize = () => savePosition(position);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [position, savePosition]);

    useEffect(() => {
        return () => {
            if (modeTimeoutRef.current) {
                window.clearTimeout(modeTimeoutRef.current);
            }
        };
    }, []);

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
            moved: false,
        };
    };

    const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        const movedDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (movedDistance > 5) {
            drag.moved = true;
            movedRecentlyRef.current = true;
            setMode('dragged');
            setBubbleText(modeView.dragged.phrase);
        }

        const nextPosition = clampPosition({
            x: event.clientX - drag.offsetX,
            y: event.clientY - drag.offsetY,
        });

        positionRef.current = nextPosition;
        setPosition(nextPosition);
    };

    const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
        savePosition(positionRef.current);

        if (drag.moved) {
            setTemporaryMode('happy');
            window.setTimeout(() => {
                movedRecentlyRef.current = false;
            }, 160);
        }
    };

    const handlePetClick = () => {
        if (movedRecentlyRef.current) {
            return;
        }

        setChatOpen((opened) => !opened);
        setTemporaryMode('happy');
    };

    const handleHide = () => {
        setVisible(false);
        setChatOpen(false);
        window.localStorage.setItem(VISIBLE_KEY, 'false');
    };

    const handleShow = () => {
        setVisible(true);
        window.localStorage.setItem(VISIBLE_KEY, 'true');
        setTemporaryMode('happy');
    };

    const handleResetPosition = () => {
        savePosition(defaultPosition());
        setTemporaryMode('happy');
    };

    const sendMockMessage = () => {
        const text = input.trim();
        if (!text) {
            return;
        }

        const reply = mockReplies[Math.floor(Math.random() * mockReplies.length)] ?? mockReplies[0];
        setMessages((current) => [
            ...current,
            { id: messageIdRef.current++, author: 'user', text },
            { id: messageIdRef.current++, author: 'pet', text: reply },
        ]);
        setInput('');
        setTemporaryMode('happy');
    };

    const petStyle = useMemo(() => ({
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
    }), [position.x, position.y]);

    if (loading || !currentUser) {
        return null;
    }

    if (!visible) {
        return (
            <button
                type="button"
                onClick={handleShow}
                className="fixed bottom-4 right-4 z-50 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-lg transition hover:bg-gray-50"
            >
                Вернуть Бублика
            </button>
        );
    }

    return (
        <div className="fixed left-0 top-0 z-50" style={petStyle}>
            {chatOpen && (
                <div className="absolute bottom-[76px] right-0 w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                        <div>
                            <p className="text-sm font-semibold text-gray-950">Бублик</p>
                            <p className="text-xs text-gray-500">mock-чат</p>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={handleResetPosition}
                                className="rounded-full px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                            >
                                Сброс
                            </button>
                            <button
                                type="button"
                                onClick={handleHide}
                                className="rounded-full px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                            >
                                Скрыть
                            </button>
                        </div>
                    </div>

                    <div className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                    message.author === 'pet'
                                        ? 'bg-gray-100 text-gray-800'
                                        : 'ml-auto bg-[var(--app-accent)] text-white'
                                }`}
                            >
                                {message.text}
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2 border-t border-gray-100 p-3">
                        <input
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    sendMockMessage();
                                }
                            }}
                            className="min-w-0 flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--app-accent)]"
                            placeholder="Написать Бублику"
                        />
                        <button
                            type="button"
                            onClick={sendMockMessage}
                            className="rounded-full bg-[var(--app-accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--app-accent-strong)]"
                        >
                            OK
                        </button>
                    </div>
                </div>
            )}

            <div className="pointer-events-none absolute bottom-[72px] right-0 max-w-48 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-lg">
                {bubbleText}
            </div>

            <button
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onClick={handlePetClick}
                className={`flex h-16 w-16 touch-none select-none items-center justify-center rounded-full border border-sky-100 bg-white text-3xl shadow-xl transition duration-200 ${view.className}`}
                title="Бублик"
                aria-label="Бублик"
            >
                <span aria-hidden="true">{view.emoji}</span>
            </button>
        </div>
    );
}
