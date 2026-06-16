import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const useChatScroll = (resetKey?: unknown) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isAutoScroll = useRef(true);
    const animationFrameRef = useRef<number | null>(null);
    const timeoutRefs = useRef<number[]>([]);

    const clearScheduledScrolls = useCallback(() => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        timeoutRefs.current.forEach(timeoutId => window.clearTimeout(timeoutId));
        timeoutRefs.current = [];
    }, []);

    const scrollToBottom = useCallback(() => {
        const container = messagesEndRef.current?.parentElement;

        if (!container) {
            return;
        }

        container.scrollTop = container.scrollHeight;
    }, []);

    const scheduleScrollToBottom = useCallback((force = false) => {
        clearScheduledScrolls();

        const run = () => {
            if (force || isAutoScroll.current) {
                scrollToBottom();
            }
        };

        animationFrameRef.current = window.requestAnimationFrame(run);
        timeoutRefs.current = [50, 150, 350].map(delay => window.setTimeout(run, delay));
    }, [clearScheduledScrolls, scrollToBottom]);

    const forceScrollToBottom = useCallback(() => {
        isAutoScroll.current = true;
        scheduleScrollToBottom(true);
    }, [scheduleScrollToBottom]);

    const scrollToBottomIfNeeded = useCallback(() => {
        scheduleScrollToBottom(false);
    }, [scheduleScrollToBottom]);

    useLayoutEffect(() => {
        if (isAutoScroll.current) {
            scheduleScrollToBottom();
        }
    });

    useLayoutEffect(() => {
        forceScrollToBottom();
    }, [forceScrollToBottom, resetKey]);

    useEffect(() => {
        return () => clearScheduledScrolls();
    }, [clearScheduledScrolls]);

    useEffect(() => {
        const container = messagesEndRef.current?.parentElement;

        if (!container) {
            return;
        }

        const scheduleIfNeeded = () => {
            if (isAutoScroll.current) {
                scheduleScrollToBottom();
            }
        };

        container.addEventListener('load', scheduleIfNeeded, true);
        window.addEventListener('resize', scheduleIfNeeded);

        return () => {
            container.removeEventListener('load', scheduleIfNeeded, true);
            window.removeEventListener('resize', scheduleIfNeeded);
        };
    });

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        isAutoScroll.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    };

    return { messagesEndRef, handleScroll, forceScrollToBottom, scrollToBottomIfNeeded };
};
