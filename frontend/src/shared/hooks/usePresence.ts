import { useEffect, useState } from 'react';
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { presenceService } from "@/shared/api/presenceService.js";

import type { WsEvent } from "@/shared/types/ws.js";
import { WS_EVENTS } from '@social/shared';
export const presenceMap = new Map<number, boolean>();
export const usePresence = (
    userId: number | undefined
) => {

    const wsService = useWebSocket();
    const [online, setOnline] =
        useState(false);

    useEffect(() => {

        if (!userId) {
            setOnline(false);
            return;
        }

        let cancelled = false;

        const cached =
            presenceMap.get(userId);

        if (cached !== undefined) {
            setOnline(cached);
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

                if (!cancelled) {
                    setOnline(data.online);
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
    };
};
