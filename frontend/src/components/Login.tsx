import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuthCard } from './auth/AuthCard.js';
import { AuthField } from './auth/AuthField.js';
import { useAuth } from '../contexts/AuthContext.js';
import { loginErrorMessage } from '../utils/authErrors.js';

type LoginForm = {
    email: string;
    password: string;
};

const initialForm: LoginForm = {
    email: '',
    password: '',
};

function Login() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [formData, setFormData] = useState(initialForm);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const field = event.target.name as keyof LoginForm;

        setFormData(prev => ({
            ...prev,
            [field]: event.target.value,
        }));
        setError('');
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            const user = await login(formData);
            navigate(`/users/${user.id}`);
        } catch (error: unknown) {
            setError(loginErrorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Вход"
            error={error}
            footer={(
                <>
                    Нет аккаунта?{' '}
                    <Link to="/register" className="text-sky-600 hover:underline">
                        Зарегистрироваться
                    </Link>
                </>
            )}
        >
            <form onSubmit={handleSubmit}>
                <AuthField
                    label="Email"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                />
                <AuthField
                    label="Пароль"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    autoComplete="current-password"
                    className="mb-6"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                >
                    {loading ? 'Вход...' : 'Войти'}
                </button>
            </form>
        </AuthCard>
    );
}

export default Login;
