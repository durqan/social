import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useAuth } from "@/app/providers/AuthContext.js";

type PetMode = 'idle' | 'walking' | 'sleeping' | 'happy';
type PetVariant = 'cat' | 'dog' | 'robot' | 'slime';

type PetPosition = {
    x: number;
    y: number;
};

type MockMessage = {
    id: number;
    author: 'pet' | 'user';
    text: string;
};

type PetConfig = {
    label: string;
    emoji: Record<PetMode, string>;
    colors: {
        body: string;
        belly: string;
        accent: string;
        stroke: string;
    };
};

const POSITION_KEY = 'aiPetCompanion.position';
const VISIBLE_KEY = 'aiPetCompanion.visible';
const VARIANT_KEY = 'aiPetCompanion.variant';
const PET_NAME = 'Бублик';
const PET_SIZE = 88;
const EDGE_PADDING = 16;

const petConfigs: Record<PetVariant, PetConfig> = {
    cat: {
        label: 'Кот',
        emoji: {
            idle: '🐱',
            walking: '🐾',
            sleeping: '💤',
            happy: '😸',
        },
        colors: {
            body: '#f59e0b',
            belly: '#fde68a',
            accent: '#f97316',
            stroke: '#92400e',
        },
    },
    dog: {
        label: 'Собака',
        emoji: {
            idle: '🐶',
            walking: '🐕',
            sleeping: '💤',
            happy: '😄',
        },
        colors: {
            body: '#a16207',
            belly: '#fef3c7',
            accent: '#78350f',
            stroke: '#713f12',
        },
    },
    robot: {
        label: 'Робот',
        emoji: {
            idle: '🤖',
            walking: '⚙️',
            sleeping: '🔋',
            happy: '✨',
        },
        colors: {
            body: '#94a3b8',
            belly: '#e2e8f0',
            accent: '#38bdf8',
            stroke: '#334155',
        },
    },
    slime: {
        label: 'Слизень',
        emoji: {
            idle: '🫧',
            walking: '💧',
            sleeping: '💤',
            happy: '🟢',
        },
        colors: {
            body: '#34d399',
            belly: '#bbf7d0',
            accent: '#10b981',
            stroke: '#047857',
        },
    },
};

const modePhrase: Record<PetMode, string> = {
    idle: 'я тут',
    walking: 'пойдем смотреть ленту?',
    sleeping: 'я устал, посплю',
    happy: 'рад тебя видеть',
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

const variantOptions = Object.keys(petConfigs) as PetVariant[];

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

function readStoredVariant(): PetVariant {
    if (typeof window === 'undefined') {
        return 'cat';
    }

    const raw = window.localStorage.getItem(VARIANT_KEY);
    return raw === 'cat' || raw === 'dog' || raw === 'robot' || raw === 'slime' ? raw : 'cat';
}

function PetArt({ mode, variant, dragging }: { mode: PetMode; variant: PetVariant; dragging: boolean }) {
    const config = petConfigs[variant];
    const sleepy = mode === 'sleeping';
    const happy = mode === 'happy';
    const robot = variant === 'robot';
    const slime = variant === 'slime';
    const animal = variant === 'cat' || variant === 'dog';

    return (
        <div className={`pet-character pet-character-${mode} ${dragging ? 'pet-character-dragging' : ''}`}>
            <svg
                aria-hidden="true"
                viewBox="0 0 120 120"
                className="h-[88px] w-[88px] drop-shadow-lg"
            >
                <ellipse cx="60" cy="104" rx="34" ry="8" fill="rgba(15, 23, 42, 0.16)" />

                {animal && (
                    <>
                        {variant === 'cat' ? (
                            <>
                                <path d="M32 43 L42 18 L55 43 Z" fill={config.colors.body} stroke={config.colors.stroke} strokeWidth="4" strokeLinejoin="round" />
                                <path d="M88 43 L78 18 L65 43 Z" fill={config.colors.body} stroke={config.colors.stroke} strokeWidth="4" strokeLinejoin="round" />
                                <path d="M38 39 L43 28 L50 40 Z" fill={config.colors.belly} opacity="0.9" />
                                <path d="M82 39 L77 28 L70 40 Z" fill={config.colors.belly} opacity="0.9" />
                            </>
                        ) : (
                            <>
                                <ellipse cx="31" cy="54" rx="13" ry="24" fill={config.colors.accent} stroke={config.colors.stroke} strokeWidth="4" transform="rotate(18 31 54)" />
                                <ellipse cx="89" cy="54" rx="13" ry="24" fill={config.colors.accent} stroke={config.colors.stroke} strokeWidth="4" transform="rotate(-18 89 54)" />
                            </>
                        )}

                        <circle cx="60" cy="59" r="36" fill={config.colors.body} stroke={config.colors.stroke} strokeWidth="4" />
                        <ellipse cx="60" cy="75" rx="20" ry="15" fill={config.colors.belly} opacity="0.92" />
                        <circle cx="47" cy="57" r={sleepy ? 0 : 4} fill="#111827" />
                        <circle cx="73" cy="57" r={sleepy ? 0 : 4} fill="#111827" />
                        {sleepy && (
                            <>
                                <path d="M42 57 Q47 53 52 57" fill="none" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
                                <path d="M68 57 Q73 53 78 57" fill="none" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
                            </>
                        )}
                        <path d="M55 67 Q60 71 65 67" fill="none" stroke="#111827" strokeWidth="3" strokeLinecap="round" />
                        <path
                            d={happy ? "M48 76 Q60 88 72 76" : "M52 76 Q60 82 68 76"}
                            fill="none"
                            stroke="#111827"
                            strokeWidth="4"
                            strokeLinecap="round"
                        />
                        <path d="M52 66 L60 72 L68 66" fill="none" stroke={config.colors.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                    </>
                )}

                {robot && (
                    <>
                        <rect x="30" y="34" width="60" height="58" rx="16" fill={config.colors.body} stroke={config.colors.stroke} strokeWidth="4" />
                        <rect x="43" y="24" width="34" height="12" rx="6" fill={config.colors.accent} stroke={config.colors.stroke} strokeWidth="4" />
                        <line x1="60" y1="24" x2="60" y2="13" stroke={config.colors.stroke} strokeWidth="4" strokeLinecap="round" />
                        <circle cx="60" cy="11" r="5" fill={config.colors.accent} />
                        <rect x="42" y="52" width="14" height="12" rx="4" fill={sleepy ? config.colors.belly : config.colors.accent} />
                        <rect x="64" y="52" width="14" height="12" rx="4" fill={sleepy ? config.colors.belly : config.colors.accent} />
                        <rect x="47" y="74" width="26" height="6" rx="3" fill={happy ? config.colors.accent : config.colors.stroke} />
                        <circle cx="35" cy="88" r="6" fill={config.colors.accent} />
                        <circle cx="85" cy="88" r="6" fill={config.colors.accent} />
                    </>
                )}

                {slime && (
                    <>
                        <path
                            d="M25 83 C25 51 43 34 61 34 C80 34 96 53 96 83 C96 95 83 101 60 101 C37 101 25 95 25 83 Z"
                            fill={config.colors.body}
                            stroke={config.colors.stroke}
                            strokeWidth="4"
                        />
                        <ellipse cx="59" cy="79" rx="25" ry="13" fill={config.colors.belly} opacity="0.75" />
                        <circle cx="49" cy="65" r={sleepy ? 0 : 4} fill="#064e3b" />
                        <circle cx="72" cy="65" r={sleepy ? 0 : 4} fill="#064e3b" />
                        {sleepy && (
                            <>
                                <path d="M44 65 Q49 61 54 65" fill="none" stroke="#064e3b" strokeWidth="4" strokeLinecap="round" />
                                <path d="M67 65 Q72 61 77 65" fill="none" stroke="#064e3b" strokeWidth="4" strokeLinecap="round" />
                            </>
                        )}
                        <path
                            d={happy ? "M49 76 Q60 87 72 76" : "M53 78 Q60 82 67 78"}
                            fill="none"
                            stroke="#064e3b"
                            strokeWidth="4"
                            strokeLinecap="round"
                        />
                        <circle cx="78" cy="43" r="6" fill={config.colors.belly} opacity="0.72" />
                    </>
                )}
            </svg>

            <span className="absolute -right-1 -top-2 rounded-full border border-white bg-white px-1.5 py-0.5 text-base shadow-sm">
                {config.emoji[mode]}
            </span>
        </div>
    );
}

export function PetCompanion() {
    const { currentUser, loading } = useAuth();
    const [position, setPosition] = useState<PetPosition>(() => readStoredPosition());
    const [visible, setVisible] = useState(() => readStoredVisible());
    const [variant, setVariant] = useState<PetVariant>(() => readStoredVariant());
    const [mode, setMode] = useState<PetMode>('idle');
    const [dragging, setDragging] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [bubbleText, setBubbleText] = useState(modePhrase.idle);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<MockMessage[]>([
        { id: 1, author: 'pet', text: `Привет, я ${PET_NAME}. Выбери, кем мне быть сегодня.` },
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
        setBubbleText(modePhrase[nextMode]);

        if (modeTimeoutRef.current) {
            window.clearTimeout(modeTimeoutRef.current);
        }

        modeTimeoutRef.current = window.setTimeout(() => {
            setMode('idle');
            setBubbleText(modePhrase.idle);
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
            const nextPhrase = randomPhrases[Math.floor(Math.random() * randomPhrases.length)] ?? modePhrase.idle;
            const nextPosition = clampPosition({
                x: positionRef.current.x + Math.round(Math.random() * 72 - 36),
                y: positionRef.current.y + Math.round(Math.random() * 56 - 28),
            });

            positionRef.current = nextPosition;
            setPosition(nextPosition);
            window.localStorage.setItem(POSITION_KEY, JSON.stringify(nextPosition));
            setMode(nextMode);
            setBubbleText(nextPhrase);

            if (modeTimeoutRef.current) {
                window.clearTimeout(modeTimeoutRef.current);
            }

            modeTimeoutRef.current = window.setTimeout(() => {
                setMode('idle');
                setBubbleText(modePhrase.idle);
            }, 3500);
        }, 14000);

        return () => window.clearInterval(intervalId);
    }, [chatOpen, visible]);

    useEffect(() => {
        const handleResize = () => savePosition(positionRef.current);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [savePosition]);

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
            setDragging(true);
            setBubbleText('держусь!');
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
        setDragging(false);
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

    const handleVariantChange = (nextVariant: PetVariant) => {
        setVariant(nextVariant);
        window.localStorage.setItem(VARIANT_KEY, nextVariant);
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
                Вернуть {PET_NAME}
            </button>
        );
    }

    return (
        <div className="fixed left-0 top-0 z-50" style={petStyle}>
            {chatOpen && (
                <div className="absolute bottom-[98px] right-0 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                        <div>
                            <p className="text-sm font-semibold text-gray-950">{PET_NAME}</p>
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

                    <div className="border-b border-gray-100 px-4 py-3">
                        <p className="mb-2 text-xs font-semibold uppercase text-gray-400">Вид питомца</p>
                        <div className="grid grid-cols-4 gap-2">
                            {variantOptions.map((option) => {
                                const selected = option === variant;

                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => handleVariantChange(option)}
                                        className={`rounded-xl border px-2 py-2 text-center text-xs font-medium transition ${
                                            selected
                                                ? 'border-[var(--app-accent)] bg-sky-50 text-sky-700'
                                                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span className="block text-lg" aria-hidden="true">
                                            {petConfigs[option].emoji.idle}
                                        </span>
                                        {petConfigs[option].label}
                                    </button>
                                );
                            })}
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
                            placeholder={`Написать ${PET_NAME}`}
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

            <div className="pointer-events-none absolute bottom-[98px] right-0 max-w-52 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-lg">
                {bubbleText}
            </div>

            <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-sm">
                {PET_NAME}
            </div>

            <button
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onClick={handlePetClick}
                className="relative flex h-[88px] w-[88px] touch-none select-none items-center justify-center rounded-[28px] bg-transparent outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
                title={PET_NAME}
                aria-label={PET_NAME}
            >
                <PetArt mode={mode} variant={variant} dragging={dragging} />
            </button>
        </div>
    );
}
