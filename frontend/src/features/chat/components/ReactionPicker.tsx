import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

interface ReactionPickerProps {
    anchorRect: DOMRect;
    selectedEmoji?: string;
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

const viewportMargin = 10;
const anchorGap = 8;

export function ReactionPicker({
    anchorRect,
    selectedEmoji,
    onSelect,
    onClose,
}: ReactionPickerProps) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const selectTimerRef = useRef<number | null>(null);
    const [position, setPosition] = useState({ left: viewportMargin, top: viewportMargin, ready: false });
    const [poppingEmoji, setPoppingEmoji] = useState<string | null>(null);

    useLayoutEffect(() => {
        const picker = pickerRef.current;
        if (!picker) {
            return;
        }

        const { width, height } = picker.getBoundingClientRect();
        const maxLeft = Math.max(viewportMargin, window.innerWidth - width - viewportMargin);
        const maxTop = Math.max(viewportMargin, window.innerHeight - height - viewportMargin);
        const centeredLeft = anchorRect.left + (anchorRect.width - width) / 2;
        const left = Math.max(viewportMargin, Math.min(centeredLeft, maxLeft));
        const below = anchorRect.bottom + anchorGap;
        const top = below + height <= window.innerHeight - viewportMargin
            ? below
            : Math.max(viewportMargin, Math.min(anchorRect.top - height - anchorGap, maxTop));

        setPosition({ left, top, ready: true });
    }, [anchorRect]);

    useEffect(() => {
        const closeOnPointerDown = (event: PointerEvent) => {
            if (!pickerRef.current?.contains(event.target as Node)) {
                onClose();
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('pointerdown', closeOnPointerDown);
        window.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('pointerdown', closeOnPointerDown);
            window.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('keydown', closeOnEscape);
            if (selectTimerRef.current !== null) {
                window.clearTimeout(selectTimerRef.current);
            }
        };
    }, [onClose]);

    const selectEmoji = (emoji: string) => {
        setPoppingEmoji(emoji);
        if (selectTimerRef.current !== null) {
            window.clearTimeout(selectTimerRef.current);
        }
        selectTimerRef.current = window.setTimeout(() => onSelect(emoji), 140);
    };

    return createPortal((
        <div
            ref={pickerRef}
            role="menu"
            aria-label="Выберите реакцию"
            className="reaction-picker"
            style={{
                left: position.left,
                top: position.top,
                visibility: position.ready ? 'visible' : 'hidden',
            }}
            onPointerDown={event => event.stopPropagation()}
        >
            {quickReactions.map(emoji => (
                <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    className={`reaction-picker__emoji ${selectedEmoji === emoji ? 'reaction-picker__emoji--selected' : ''} ${poppingEmoji === emoji ? 'reaction-picker__emoji--pop' : ''}`}
                    aria-label={`${selectedEmoji === emoji ? 'Убрать' : 'Поставить'} реакцию ${emoji}`}
                    onClick={() => selectEmoji(emoji)}
                >
                    {emoji}
                </button>
            ))}
        </div>
    ), document.body);
}
