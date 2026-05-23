import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authService } from '../services/authService.js';
import { getApiError } from '../api/errors.js';

type VerifyState = 'loading' | 'success' | 'error';

function VerifyEmail() {
    const { token } = useParams();
    const [state, setState] = useState<VerifyState>('loading');
    const [message, setMessage] = useState('Подтверждаем почту...');

    useEffect(() => {
        if (!token) {
            setState('error');
            setMessage('Ссылка подтверждения некорректна');
            return;
        }

        authService.verifyEmail(token)
            .then(() => {
                setState('success');
                setMessage('Почта успешно подтверждена');
            })
            .catch((err: unknown) => {
                const apiError = getApiError(err);
                setState('error');
                setMessage(apiError.error || apiError.message || 'Не удалось подтвердить почту');
            });
    }, [token]);

    return (
        <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center px-4 py-6">
            <div className="app-card w-full max-w-md p-5 text-center sm:p-8">
                <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                    state === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : state === 'error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-sky-100 text-sky-700'
                }`}>
                    {state === 'success' ? '✓' : state === 'error' ? '!' : '...'}
                </div>

                <h1 className="text-xl font-bold text-gray-800 mb-3 sm:text-2xl">
                    {state === 'success'
                        ? 'Email подтвержден'
                        : state === 'error'
                            ? 'Не удалось подтвердить email'
                            : 'Подтверждение email'}
                </h1>

                <p className="text-gray-600 mb-6">{message}</p>

                <Link
                    to="/"
                    className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-5 py-2 text-white transition hover:bg-sky-700"
                >
                    Перейти в профиль
                </Link>
            </div>
        </div>
    );
}

export default VerifyEmail;
