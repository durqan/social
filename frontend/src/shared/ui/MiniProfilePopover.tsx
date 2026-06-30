import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from "@/shared/hooks/usePresence.js";
import { userService } from "@/shared/api/userService.js";
import type { User } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";
import { formatLastSeen } from "@/shared/utils/date.js";

type MiniProfileAnchor = {
    userId: number;
    anchorRect: DOMRect;
    user?: User | null;
};

interface MiniProfilePopoverProps {
    profile: MiniProfileAnchor | null;
    currentUserId?: number;
    onClose: () => void;
    onOpenProfile: (userId: number) => void;
    onMessage?: (userId: number) => void;
    onCall?: (userId: number) => void;
}

const viewportMargin = 12;

export function MiniProfilePopover({
    profile,
    currentUserId,
    onClose,
    onOpenProfile,
    onMessage,
    onCall,
}: MiniProfilePopoverProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [fetchedUser, setFetchedUser] = useState<User | null>(null);
    const [position, setPosition] = useState({ left: viewportMargin, top: viewportMargin, ready: false });
    const [compact, setCompact] = useState(() => window.innerWidth < 640);
    const { online, lastSeenAt } = usePresence(profile?.userId);

    useEffect(() => {
        if (!profile?.userId) {
            return;
        }

        let cancelled = false;
        userService.getUser(profile.userId)
            .then(user => {
                if (!cancelled) {
                    setFetchedUser(user);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [profile?.userId]);

    useEffect(() => {
        if (!profile) {
            return;
        }

        const closeOnPointerDown = (event: PointerEvent) => {
            if (!panelRef.current?.contains(event.target as Node)) {
                onClose();
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        const handleResize = () => {
            setCompact(window.innerWidth < 640);
            onClose();
        };

        window.addEventListener('pointerdown', closeOnPointerDown);
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('pointerdown', closeOnPointerDown);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [onClose, profile]);

    useLayoutEffect(() => {
        if (!profile || compact) {
            return;
        }

        const panel = panelRef.current;
        if (!panel) {
            return;
        }

        const { width, height } = panel.getBoundingClientRect();
        const maxLeft = Math.max(viewportMargin, window.innerWidth - width - viewportMargin);
        const maxTop = Math.max(viewportMargin, window.innerHeight - height - viewportMargin);
        const left = Math.max(viewportMargin, Math.min(profile.anchorRect.left, maxLeft));
        const preferredTop = profile.anchorRect.bottom + 8;
        const top = preferredTop + height <= window.innerHeight - viewportMargin
            ? preferredTop
            : Math.max(viewportMargin, Math.min(profile.anchorRect.top - height - 8, maxTop));

        setPosition({ left, top, ready: true });
    }, [compact, fetchedUser, profile]);

    const user = fetchedUser?.id === profile?.userId ? fetchedUser : profile?.user ?? null;
    const statusText = online ? 'в сети' : formatLastSeen(lastSeenAt ?? user?.last_seen_at);
    const metaText = useMemo(() => user?.email || (user?.id ? `id${user.id}` : ''), [user?.email, user?.id]);

    if (!profile) {
        return null;
    }

    const targetUserId = user?.id ?? profile.userId;
    const isSelf = currentUserId === targetUserId;
    const runAndClose = (action: () => void) => {
        action();
        onClose();
    };

    return createPortal((
        <>
            {compact ? (
                <button
                    type="button"
                    className="mini-profile-sheet-backdrop"
                    aria-label="Закрыть мини-профиль"
                    onClick={onClose}
                />
            ) : null}
            <div
                ref={panelRef}
                className={compact ? 'mini-profile-sheet' : 'mini-profile-popover'}
                style={compact ? undefined : {
                    left: position.left,
                    top: position.top,
                    visibility: position.ready ? 'visible' : 'hidden',
                }}
                role="dialog"
                aria-label="Мини-профиль"
                onPointerDown={event => event.stopPropagation()}
            >
                {compact ? <div className="mini-profile-sheet__handle" aria-hidden="true" /> : null}
                <div className="mini-profile-popover__header">
                    <Avatar
                        name={user?.name}
                        src={user?.avatar}
                        positionX={user?.avatarPositionX ?? user?.avatar_position_x}
                        positionY={user?.avatarPositionY ?? user?.avatar_position_y}
                        scale={user?.avatarScale ?? user?.avatar_scale}
                        size="list"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="mini-profile-popover__name">{user?.name || 'Пользователь'}</p>
                        {statusText ? (
                            <p className={online ? 'mini-profile-popover__status mini-profile-popover__status--online' : 'mini-profile-popover__status'}>
                                {statusText}
                            </p>
                        ) : null}
                        {metaText ? <p className="mini-profile-popover__meta">{metaText}</p> : null}
                    </div>
                </div>
                <div className="mini-profile-popover__actions">
                    <button
                        type="button"
                        className="mini-profile-popover__action"
                        onClick={() => runAndClose(() => onOpenProfile(targetUserId))}
                    >
                        <Icon name="home" className="h-4 w-4" />
                        Профиль
                    </button>
                    {!isSelf && onMessage ? (
                        <button
                            type="button"
                            className="mini-profile-popover__action mini-profile-popover__action--primary"
                            onClick={() => runAndClose(() => onMessage(targetUserId))}
                        >
                            <Icon name="messages" className="h-4 w-4" />
                            Написать
                        </button>
                    ) : null}
                    {!isSelf && onCall ? (
                        <button
                            type="button"
                            className="mini-profile-popover__action"
                            onClick={() => runAndClose(() => onCall(targetUserId))}
                        >
                            <Icon name="phone" className="h-4 w-4" />
                            Позвонить
                        </button>
                    ) : null}
                </div>
            </div>
        </>
    ), document.body);
}
