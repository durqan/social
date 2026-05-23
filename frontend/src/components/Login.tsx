import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { getApiError } from '../api/errors.js';

function Login() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        if (error) setError('');
    };

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const user = await login(formData);
            navigate(`/users/${user.id}`);
        } catch (err: unknown) {
            const apiError = getApiError(err);
            if (apiError.error) {
                setError(apiError.error);
            } else if (apiError.message) {
                setError(apiError.message);
            } else if (apiError.networkError) {
                setError('Ошибка сети. Проверьте подключение к серверу');
            } else {
                setError('Неверный email или пароль');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center px-4 py-6">
            <div className="app-card w-full max-w-sm p-5 sm:p-8">
                <h2 className="text-2xl font-semibold tracking-tight text-center mb-6">Вход</h2>
                {error && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 mb-2">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            className="app-input px-3 py-2"
                        />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 mb-2">Пароль</label>
                        <input
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                            className="app-input px-3 py-2"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? 'Вход...' : 'Войти'}
                    </button>
                </form>
                <p className="mt-4 text-center text-sm text-gray-600 sm:text-base">
                    Нет аккаунта?{' '}
                    <a href="/register" className="text-sky-600 hover:underline">
                        Зарегистрироваться
                    </a>
                </p>
            </div>
        </div>
    );
}

export default Login;
