import { useState } from 'react';

import { useAuth } from "@/app/providers/AuthContext.js";
import { requestAndEnableWebPush } from "@/features/bootstrap/postAuthBootstrap.js";
import { usePostAuthBootstrap } from "@/features/bootstrap/usePostAuthBootstrap.js";
import {
    dismissPushPrompt,
    isPushPromptDismissed,
} from "@/features/notifications/lib/pushPromptDismissal.js";

export function PushPermissionBanner() {
    const { currentUser } = useAuth();
    const bootstrap = usePostAuthBootstrap();
    const [dismissed, setDismissed] = useState(() => isPushPromptDismissed(window.localStorage));
    const [requesting, setRequesting] = useState(false);

    if (!currentUser?.id || bootstrap.webPush.status !== 'prompt' || dismissed) {
        return null;
    }

    const handleEnable = async () => {
        setRequesting(true);
        try {
            await requestAndEnableWebPush(currentUser.id!);
        } catch {
            // Bootstrap state already contains the user-facing error.
        } finally {
            setRequesting(false);
        }
    };

    const handleDismiss = () => {
        dismissPushPrompt(window.localStorage);
        setDismissed(true);
    };

    return (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 shadow-xl sm:bottom-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-[var(--app-text-primary)]">
                    Включить уведомления о сообщениях и звонках?
                </p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        className="app-button-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                        disabled={requesting}
                        onClick={handleEnable}
                    >
                        {requesting ? 'Подключение...' : 'Включить'}
                    </button>
                    <button
                        type="button"
                        className="app-button-secondary rounded-xl px-4 py-2 text-sm font-semibold"
                        onClick={handleDismiss}
                    >
                        Не сейчас
                    </button>
                </div>
            </div>
        </div>
    );
}
