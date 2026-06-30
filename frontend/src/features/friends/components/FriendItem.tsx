import {useRef, type KeyboardEvent, type MouseEvent, type TouchEvent} from 'react';
import {useNavigate} from 'react-router-dom';

import {usePresence} from "@/shared/hooks/usePresence.js";
import type {User} from "@/shared/types/domain.js";
import {Avatar} from "@/shared/ui/Avatar.js";
import {formatLastSeen} from "@/shared/utils/date.js";

type FriendItemProps = {
    friend: User;
    active: boolean;
    onOpenMenu: (friend: User, position: { x: number; y: number }, mode: 'desktop' | 'mobile') => void;
    onOpenMiniProfile: (friend: User, anchorRect: DOMRect) => void;
};

export function FriendItem({friend, active, onOpenMenu, onOpenMiniProfile}: FriendItemProps) {
    const navigate = useNavigate();
    const friendID = friend.id;
    const {online, lastSeenAt} = usePresence(friendID);
    const statusText = online
        ? 'в сети'
        : formatLastSeen(lastSeenAt ?? friend.last_seen_at);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const suppressClickRef = useRef(false);

    if (!friendID) {
        return null;
    }

    const clearLongPress = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const openProfile = () => {
        navigate(`/users/${friendID}`);
    };

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(friend, {x: event.clientX, y: event.clientY}, 'desktop');
    };

    const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        if (!touch) {
            return;
        }

        touchStartRef.current = {x: touch.clientX, y: touch.clientY};
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
            suppressClickRef.current = true;
            navigator.vibrate?.(8);
            document.getSelection()?.removeAllRanges();
            onOpenMenu(friend, {x: touch.clientX, y: touch.clientY}, 'mobile');
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 700);
        }, 520);
    };

    const handleTouchEnd = () => {
        clearLongPress();
        touchStartRef.current = null;
    };

    const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
        const start = touchStartRef.current;
        const touch = event.touches[0];

        if (!start || !touch) {
            return;
        }

        if (Math.abs(touch.clientX - start.x) > 8 || Math.abs(touch.clientY - start.y) > 8) {
            handleTouchEnd();
        }
    };

    const handleClick = () => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }

        openProfile();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        handleClick();
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onTouchMove={handleTouchMove}
            className={`app-interactive-card flex w-full select-none items-center gap-3 rounded-xl p-3
            text-left transition cursor-pointer [-webkit-touch-callout:none] [-webkit-user-select:none]
            hover:bg-gray-50 ${active ? 'relative z-[60] bg-white shadow-2xl ring-2 ring-white/80' : ''}`}
            style={{touchAction: 'manipulation'}}
        >
            <Avatar
                name={friend.name}
                src={friend.avatar}
                positionX={friend.avatarPositionX}
                positionY={friend.avatarPositionY}
                scale={friend.avatarScale}
                size="list"
                ariaLabel={`Открыть мини-профиль ${friend.name || 'пользователя'}`}
                onClick={event => onOpenMiniProfile(friend, event.currentTarget.getBoundingClientRect())}
            />
            <button
                type="button"
                className="min-w-0 text-left"
                onClick={event => {
                    event.stopPropagation();
                    onOpenMiniProfile(friend, event.currentTarget.getBoundingClientRect());
                }}
            >
                <span className="block truncate font-semibold text-gray-800">
                    {friend.name || 'Пользователь'}
                </span>
                {friend.email ? (
                    <span className="block truncate text-sm text-gray-500">
                        {friend.email}
                    </span>
                ) : null}
                {statusText && (
                    <span className={online ? 'block text-sm text-green-500' : 'block text-sm text-gray-400'}>
                        {statusText}
                    </span>
                )}
            </button>
        </div>
    );
}
