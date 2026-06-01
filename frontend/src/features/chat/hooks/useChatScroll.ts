import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const useChatScroll = (_dependency: unknown[]) => {
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

    const scheduleScrollToBottom = useCallback(() => {
        clearScheduledScrolls();

        const run = () => {
            if (isAutoScroll.current) {
                scrollToBottom();
            }
        };

        animationFrameRef.current = window.requestAnimationFrame(run);
        timeoutRefs.current = [50, 150, 350].map(delay => window.setTimeout(run, delay));
    }, [clearScheduledScrolls, scrollToBottom]);

    useLayoutEffect(() => {
        if (isAutoScroll.current) {
            scheduleScrollToBottom();
        }
    });

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

    return { messagesEndRef, handleScroll };
};
