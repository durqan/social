import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useAuth } from "@/app/providers/AuthContext.js";
import { authService } from "@/features/auth/api/authService.js";
import { AuthCard } from "@/features/auth/ui/AuthCard.js";
import { AuthField } from "@/features/auth/ui/AuthField.js";
import { getApiError } from "@/shared/api/errors.js";

type ResetPasswordForm = {
    password: string;
    confirmPassword: string;
};

const initialForm: ResetPasswordForm = {
    password: '',
    confirmPassword: '',
};

function ResetPassword() {
    const [searchParams] = useSearchParams();
    const { currentUser, logout } = useAuth();
    const token = searchParams.get('token') || '';
    const [formData, setFormData] = useState(initialForm);
    const [error, setError] = useState(token ? '' : 'Ссылка восстановления некорректна: token отсутствует');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const field = event.target.name as keyof ResetPasswordForm;

        setFormData(prev => ({
            ...prev,
            [field]: event.target.value,
        }));
        setError(token ? '' : 'Ссылка восстановления некорректна: token отсутствует');
        setMessage('');
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setMessage('');

        if (!token) {
            setError('Ссылка восстановления некорректна: token отсутствует');
            return;
        }
        if (formData.password.length < 6) {
            setError('Пароль должен содержать минимум 6 символов');
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            setError('Пароли не совпадают');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const responseMessage = await authService.resetPassword({
                token,
                password: formData.password,
            });
            setMessage(responseMessage || 'Пароль успешно обновлён');
            setFormData(initialForm);
            if (currentUser) {
                await logout().catch(() => undefined);
            }
        } catch (err: unknown) {
            const apiError = getApiError(err);
            setError(apiError.error || apiError.message || 'Не удалось обновить пароль');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Новый пароль"
            error={error}
            footer={(
                <Link to="/login" className="text-sky-600 hover:underline">
                    Вернуться ко входу
                </Link>
            )}
        >
            {message ? (
                <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                        {message}
                    </div>
                    <Link
                        to="/login"
                        className="flex w-full items-center justify-center rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700"
                    >
                        Войти
                    </Link>
                </div>
            ) : (
                <form onSubmit={handleSubmit}>
                    <AuthField
                        label="Новый пароль"
                        type="password"
                        name="password"
                        value={formData.password}
                        onChange={handleChange}
                        autoComplete="new-password"
                    />
                    <AuthField
                        label="Повторите пароль"
                        type="password"
                        name="confirmPassword"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        autoComplete="new-password"
                        className="mb-6"
                    />
                    <button
                        type="submit"
                        disabled={loading || !token}
                        className="w-full rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? 'Обновляем...' : 'Обновить пароль'}
                    </button>
                </form>
            )}
        </AuthCard>
    );
}

export default ResetPassword;
