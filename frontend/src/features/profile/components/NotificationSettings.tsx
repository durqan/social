import { useState } from 'react';

import { useAuth } from "@/app/providers/AuthContext.js";
import {
    ensureWebPushForUser,
    requestAndEnableWebPush,
} from "@/features/bootstrap/postAuthBootstrap.js";
import { usePostAuthBootstrap } from "@/features/bootstrap/usePostAuthBootstrap.js";

const statusText = {
    checking: 'Проверка...',
    granted: 'Включены',
    prompt: 'Не включены',
    denied: 'Заблокированы браузером',
    unsupported: 'Не поддерживаются браузером',
    unconfigured: 'Не настроены на сервере',
    error: 'Ошибка настройки',
} as const;

export function NotificationSettings() {
    const { currentUser } = useAuth();
    const bootstrap = usePostAuthBootstrap();
    const [busy, setBusy] = useState(false);
    const userId = currentUser?.id;
    const status = bootstrap.webPush.status;

    const run = async (requestPermission: boolean) => {
        if (!userId) {
            return;
        }
        setBusy(true);
        try {
            if (requestPermission) {
                await requestAndEnableWebPush(userId);
            } else {
                await ensureWebPushForUser(userId);
            }
        } catch {
            // Bootstrap state already contains the user-facing error.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
            <div>
                <p className="text-sm font-semibold text-[var(--app-text-primary)]">Уведомления</p>
                <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
                    Статус: {statusText[status]}
                </p>
            </div>

            {status === 'denied' && (
                <p className="text-sm text-amber-700">
                    Разрешите уведомления в настройках сайта браузера, затем повторите проверку.
                </p>
            )}
            {status === 'error' && (
                <p className="text-sm text-red-700">
                    Не удалось зарегистрировать push-подписку. Проверьте соединение и повторите попытку.
                </p>
            )}

            {(status === 'prompt' || status === 'denied' || status === 'error') && (
                <button
                    type="button"
                    disabled={busy}
                    className="app-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    onClick={() => void run(status === 'prompt')}
                >
                    {status === 'prompt' ? 'Включить уведомления' : 'Повторить проверку'}
                </button>
            )}
        </div>
    );
}
