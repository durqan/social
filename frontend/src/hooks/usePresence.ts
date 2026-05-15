import { useEffect, useState } from 'react';
import { presenceService } from '../services/presenceService.js';

export const usePresence = (
    userId: number | undefined
) => {

    const [online, setOnline] = useState(false);

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) return;
        const loadPresence = async () => {
            try {
                const data =
                    await presenceService.getPresence(
                        userId
                    );
                setOnline(data.online);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        loadPresence();
    }, [userId]);
    return {
        online,
        loading,
    };
};