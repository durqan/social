import { useState, useRef, useCallback } from 'react';

import { useWebSocket } from "@/app/providers/WebSocketContext.js";

export const useChatTyping = (userId: number) => {

    const wsService = useWebSocket();
    const [otherTyping, setOtherTyping] = useState(false);
    const typingTimeoutRef =
        useRef<ReturnType<typeof setTimeout> | null>(null);

    const sendTyping = useCallback((isTyping: boolean) => {

        if (isTyping) {
            wsService.sendTypingStart(userId);
        } else {
            wsService.sendTypingStop(userId);
        }

    }, [userId, wsService]);

    const handleTyping = useCallback(() => {

        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        sendTyping(true);

        typingTimeoutRef.current = setTimeout(() => {
            sendTyping(false);
            typingTimeoutRef.current = null;

        }, 1000);

    }, [sendTyping]);

    return {
        otherTyping,
        setOtherTyping,
        handleTyping,
    };
};