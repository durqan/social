import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { authService } from "@/features/auth/api/authService.js";
import { AuthCard } from "@/features/auth/ui/AuthCard.js";
import { AuthField } from "@/features/auth/ui/AuthField.js";
import { getApiError } from "@/shared/api/errors.js";

const neutralSuccessMessage = 'Если email существует, мы отправили ссылку для восстановления пароля';

function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setEmail(event.target.value);
        setError('');
        setMessage('');
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            const responseMessage = await authService.forgotPassword({ email });
            setMessage(responseMessage || neutralSuccessMessage);
        } catch (err: unknown) {
            const apiError = getApiError(err);
            setError(apiError.error || apiError.message || 'Не удалось отправить ссылку восстановления');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Восстановление пароля"
            error={error}
            footer={(
                <Link to="/login" className="text-sky-600 hover:underline">
                    Вернуться ко входу
                </Link>
            )}
        >
            {message && (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                    {message}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <AuthField
                    label="Email"
                    type="email"
                    name="email"
                    value={email}
                    onChange={handleChange}
                    autoComplete="email"
                    className="mb-6"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                >
                    {loading ? 'Отправляем...' : 'Отправить ссылку'}
                </button>
            </form>
        </AuthCard>
    );
}

export default ForgotPassword;
