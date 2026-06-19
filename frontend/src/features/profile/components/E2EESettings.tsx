import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import { e2eeService } from "@/shared/api/e2eeService.js";
import { clearLocalE2EEKeyBundle, getLocalE2EEKeyBundle } from "@/crypto/masterKey.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import { ensureE2EEReady } from "@/features/bootstrap/postAuthBootstrap.js";
import { usePostAuthBootstrap } from "@/features/bootstrap/usePostAuthBootstrap.js";

type E2EESettingsProps = {
    userId?: number;
};

type E2EEMessage = {
    type: 'success' | 'error';
    text: string;
};

export function E2EESettings({ userId }: E2EESettingsProps) {
    const dialog = useAppDialog();
    const bootstrap = usePostAuthBootstrap();
    const [enabled, setEnabled] = useState(false);
    const [localKeyReady, setLocalKeyReady] = useState(false);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<E2EEMessage | null>(null);

    const refreshStatus = useCallback(async () => {
        if (!userId) {
            return;
        }
        setLoading(true);
        try {
            const [status, localBundle] = await Promise.all([
                e2eeService.getStatus(),
                getLocalE2EEKeyBundle(userId),
            ]);
            setEnabled(status.enabled);
            setLocalKeyReady(Boolean(localBundle));
        } catch {
            setMessage({ type: 'error', text: 'Не удалось загрузить статус E2EE' });
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
        setPassword(event.target.value);
        setMessage(null);
    };

    const handleEnable = async (event: FormEvent) => {
        event.preventDefault();
        if (!userId || !password) {
            setMessage({ type: 'error', text: 'Введите текущий пароль аккаунта' });
            return;
        }

        setSubmitting(true);
        setMessage(null);
        try {
            const status = await ensureE2EEReady(userId, password);
            if (status !== 'ready') {
                throw new Error('E2EE bootstrap requires a secret');
            }
            setPassword('');
            setMessage({ type: 'success', text: 'Сквозное шифрование включено' });
            await refreshStatus();
        } catch {
            setMessage({ type: 'error', text: 'Не удалось включить сквозное шифрование' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleRestore = async (event: FormEvent) => {
        event.preventDefault();
        if (!userId || !password) {
            setMessage({ type: 'error', text: 'Введите пароль аккаунта' });
            return;
        }

        setSubmitting(true);
        setMessage(null);
        try {
            const status = await ensureE2EEReady(userId, password);
            if (status !== 'ready') {
                throw new Error('E2EE bootstrap requires a secret');
            }
            setPassword('');
            setMessage({ type: 'success', text: 'E2EE-ключ восстановлен на этом устройстве' });
            await refreshStatus();
        } catch {
            setMessage({ type: 'error', text: 'Не удалось восстановить ключ. Проверьте пароль.' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleDisable = async () => {
        if (!userId) {
            return;
        }

        const ok = await dialog.confirm({
            title: 'Отключить сквозное шифрование?',
            message: 'Backup ключа будет удален с сервера, а локальный ключ с этого устройства. Старые E2EE-сообщения могут стать недоступны.',
            confirmText: 'Отключить',
            cancelText: 'Отмена',
            variant: 'danger',
        });
        if (!ok) {
            return;
        }

        setSubmitting(true);
        setMessage(null);
        try {
            await e2eeService.disable();
            await clearLocalE2EEKeyBundle(userId);
            setPassword('');
            setMessage({ type: 'success', text: 'Сквозное шифрование выключено' });
            await refreshStatus();
        } catch {
            setMessage({ type: 'error', text: 'Не удалось отключить сквозное шифрование' });
        } finally {
            setSubmitting(false);
        }
    };

    const action = enabled && !localKeyReady ? handleRestore : handleEnable;
    const buttonText = enabled && !localKeyReady ? 'Восстановить ключ' : 'Включить E2EE';
    const bootstrapStatus = bootstrap.userId === userId ? bootstrap.e2ee.status : 'idle';

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">Сквозное шифрование</p>
                <p className={enabled ? 'mt-1 text-sm text-emerald-700' : 'mt-1 text-sm text-gray-500'}>
                    Статус: {loading ? 'Загрузка...' : enabled ? 'Включено' : 'Выключено'}
                </p>
                {bootstrapStatus === 'checking' && (
                    <p className="mt-1 text-xs text-gray-500">Автоматическая настройка выполняется...</p>
                )}
                {bootstrapStatus === 'error' && (
                    <p className="mt-1 text-xs text-red-600">
                        Автоматическая настройка завершилась ошибкой. Повторите попытку ниже.
                    </p>
                )}
                {bootstrapStatus === 'needs-secret' && (
                    <p className="mt-1 text-xs text-amber-600">
                        Для безопасного завершения нужен пароль аккаунта. Ключи не будут заменены автоматически.
                    </p>
                )}
                {enabled && (
                    <p className={localKeyReady ? 'mt-1 text-xs text-emerald-600' : 'mt-1 text-xs text-amber-600'}>
                        {localKeyReady ? 'Локальный ключ доступен на этом устройстве.' : 'Для чтения E2EE-сообщений восстановите ключ паролем аккаунта.'}
                    </p>
                )}
                <p className="mt-3 text-sm text-gray-600">
                    Master Key создается в браузере и не отправляется на сервер открытым. Backup шифруется ключом, полученным из пароля через Argon2id.
                </p>
            </div>

            {message && (
                <div className={`rounded-lg border px-3 py-2 text-sm ${
                    message.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                    {message.text}
                </div>
            )}

            {(!enabled || !localKeyReady) && (
                <form onSubmit={action} className="space-y-3">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Пароль аккаунта</label>
                        <input
                            type="password"
                            value={password}
                            onChange={handlePasswordChange}
                            className="app-input px-4 py-2"
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting || loading}
                        className="rounded-xl bg-sky-600 px-6 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50"
                    >
                        {submitting ? 'Обработка...' : buttonText}
                    </button>
                </form>
            )}

            {(bootstrapStatus === 'error' || bootstrapStatus === 'needs-secret') && (
                <button
                    type="button"
                    onClick={() => {
                        if (userId) {
                            void ensureE2EEReady(userId)
                                .then(refreshStatus)
                                .catch(() => {
                                    setMessage({
                                        type: 'error',
                                        text: 'Не удалось подготовить шифрование. Повторите попытку позже.',
                                    });
                                });
                        }
                    }}
                    disabled={submitting || loading}
                    className="app-button-secondary rounded-xl px-6 py-2 text-sm font-semibold disabled:opacity-50"
                >
                    Повторить настройку
                </button>
            )}

            {enabled && (
                <button
                    type="button"
                    onClick={handleDisable}
                    disabled={submitting || loading}
                    className="rounded-xl bg-red-50 px-6 py-2 text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                    Отключить E2EE
                </button>
            )}
        </div>
    );
}
