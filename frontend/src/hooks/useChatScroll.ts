import { useEffect, useRef } from 'react';

export const useChatScroll = (dependency: unknown[]) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isAutoScroll = useRef(true);

    useEffect(() => {
        if (isAutoScroll.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [dependency]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        isAutoScroll.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    };

    return { messagesEndRef, handleScroll };
};
