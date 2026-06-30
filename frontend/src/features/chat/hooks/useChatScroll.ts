import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const bottomThreshold = 100;

export const useChatScroll = (resetKey?: unknown, latestMessageKey?: unknown) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isAutoScroll = useRef(true);
    const animationFrameRef = useRef<number | null>(null);
    const timeoutRefs = useRef<number[]>([]);
    const latestMessageKeyRef = useRef<unknown>(latestMessageKey);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

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
        setIsAtBottom(true);
        setHasNewMessagesBelow(false);
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
        latestMessageKeyRef.current = latestMessageKey;
        setHasNewMessagesBelow(false);
    }, [forceScrollToBottom, resetKey]);

    useEffect(() => {
        if (latestMessageKeyRef.current === latestMessageKey) {
            return;
        }

        latestMessageKeyRef.current = latestMessageKey;

        if (!latestMessageKey) {
            setHasNewMessagesBelow(false);
            return;
        }

        if (isAutoScroll.current) {
            setHasNewMessagesBelow(false);
            scheduleScrollToBottom(false);
            return;
        }

        setHasNewMessagesBelow(true);
    }, [latestMessageKey, scheduleScrollToBottom]);

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
        const nextAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < bottomThreshold;
        isAutoScroll.current = nextAtBottom;
        setIsAtBottom(nextAtBottom);
        if (nextAtBottom) {
            setHasNewMessagesBelow(false);
        }
    };

    return {
        messagesEndRef,
        handleScroll,
        forceScrollToBottom,
        scrollToBottomIfNeeded,
        isAtBottom,
        hasNewMessagesBelow,
    };
};
