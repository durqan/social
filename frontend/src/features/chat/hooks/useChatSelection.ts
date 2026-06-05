import { useState } from 'react';

export const useChatSelection = () => {
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());

    const toggleSelect = (msgId: number) => {
        setSelectedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(msgId)) {
                newSet.delete(msgId);
                if (newSet.size === 0) setSelectionMode(false);
            } else {
                newSet.add(msgId);
            }
            return newSet;
        });
    };

    const enterSelectionMode = (msgId: number) => {
        setSelectionMode(true);
        setSelectedMessages(new Set([msgId]));
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedMessages(new Set());
    };

    return {
        selectionMode,
        selectedMessages,
        toggleSelect,
        enterSelectionMode,
        exitSelectionMode,
    };
};
