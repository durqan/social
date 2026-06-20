import { useEffect, useState } from 'react';
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { presenceService } from "@/shared/api/presenceService.js";

import type { WsEvent } from "@/shared/types/ws.js";
import { WS_EVENTS } from '@social/shared';
export const presenceMap = new Map<number, boolean>();
export const lastSeenMap = new Map<number, string | null>();
export const usePresence = (
    userId: number | undefined
) => {

    const wsService = useWebSocket();
    const [online, setOnline] =
        useState(false);
    const [lastSeenAt, setLastSeenAt] =
        useState<string | null>(null);

    useEffect(() => {

        if (!userId) {
            setOnline(false);
            setLastSeenAt(null);
            return;
        }

        let cancelled = false;

        const cached =
            presenceMap.get(userId);

        if (cached !== undefined) {
            setOnline(cached);
        }
        if (lastSeenMap.has(userId)) {
            setLastSeenAt(lastSeenMap.get(userId) ?? null);
        }

        const loadPresence = async () => {

            try {

                const data =
                    await presenceService.getPresence(
                        userId
                    );

                presenceMap.set(
                    userId,
                    data.online
                );
                lastSeenMap.set(
                    userId,
                    data.last_seen_at ?? null
                );

                if (!cancelled) {
                    setOnline(data.online);
                    setLastSeenAt(data.last_seen_at ?? null);
                }

            } catch (err) {

                if (!cancelled) {
                    console.error(err);
                }
            }
        };

        loadPresence();

        const handlePresence = (
            event: WsEvent
        ) => {

            if (
                event.type !==
                WS_EVENTS.PRESENCE_UPDATE
            ) {
                return;
            }

            if (
                event.payload.user_id !==
                userId
            ) {
                return;
            }

            presenceMap.set(
                userId,
                event.payload.online
            );
            if ('last_seen_at' in event.payload) {
                lastSeenMap.set(
                    userId,
                    event.payload.last_seen_at ?? null
                );
                setLastSeenAt(
                    event.payload.last_seen_at ?? null
                );
            }

            setOnline(
                event.payload.online
            );
        };

        wsService.onMessage(
            handlePresence
        );

        return () => {
            cancelled = true;
            wsService.removeMessageHandler(
                handlePresence
            );
        };

    }, [userId, wsService]);

    return {
        online,
        lastSeenAt,
    };
};
