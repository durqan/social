import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

import { useAuth } from "@/app/providers/AuthContext.js";
import { runPostAuthBootstrap } from "@/features/bootstrap/postAuthBootstrap.js";
import { usePostAuthBootstrap } from "@/features/bootstrap/usePostAuthBootstrap.js";

const e2eeErrorMessage = 'Не удалось подготовить шифрование. Сообщения могут быть недоступны до повторной попытки.';

export function PostAuthBootstrapManager() {
    const { currentUser } = useAuth();
    const bootstrap = usePostAuthBootstrap();
    const shownE2EEErrorRef = useRef<string | null>(null);

    useEffect(() => {
        const userId = currentUser?.id;
        if (!userId) {
            return undefined;
        }

        const retry = () => {
            void runPostAuthBootstrap(userId);
        };
        retry();

        const handleWebSocketOpen = (event: Event) => {
            const detail = (event as CustomEvent<{ reconnected?: boolean }>).detail;
            if (detail?.reconnected) {
                retry();
            }
        };

        window.addEventListener('online', retry);
        window.addEventListener('websocket:open', handleWebSocketOpen);
        window.addEventListener('push:subscription-changed', retry);
        return () => {
            window.removeEventListener('online', retry);
            window.removeEventListener('websocket:open', handleWebSocketOpen);
            window.removeEventListener('push:subscription-changed', retry);
        };
    }, [currentUser?.id]);

    useEffect(() => {
        if (bootstrap.e2ee.status !== 'error' || !bootstrap.e2ee.error) {
            return;
        }
        if (shownE2EEErrorRef.current === bootstrap.e2ee.error) {
            return;
        }

        shownE2EEErrorRef.current = bootstrap.e2ee.error;
        toast.error(e2eeErrorMessage);
    }, [bootstrap.e2ee.error, bootstrap.e2ee.status]);

    return null;
}
