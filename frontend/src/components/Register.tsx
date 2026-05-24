import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuthCard } from './auth/AuthCard.js';
import { AuthField } from './auth/AuthField.js';
import { useAuth } from '../contexts/AuthContext.js';
import { registerErrors, type RegisterFormErrors } from '../utils/authErrors.js';

type RegisterForm = {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
};

const initialForm: RegisterForm = {
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
};

function validateRegisterForm(formData: RegisterForm): RegisterFormErrors {
    const errors: RegisterFormErrors = {};

    if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Пароли не совпадают';
    }
    if (formData.password.length < 6) {
        errors.password = 'Пароль должен содержать минимум 6 символов';
    }
    if (!formData.email.includes('@')) {
        errors.email = 'Введите корректный email';
    }

    return errors;
}

function Register() {
    const navigate = useNavigate();
    const { register } = useAuth();
    const [formData, setFormData] = useState(initialForm);
    const [errors, setErrors] = useState<RegisterFormErrors>({});
    const [loading, setLoading] = useState(false);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const field = event.target.name as keyof RegisterForm;

        setFormData(prev => ({
            ...prev,
            [field]: event.target.value,
        }));
        setErrors(prev => ({
            ...prev,
            [field]: undefined,
        }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const validationErrors = validateRegisterForm(formData);
        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors);
            return;
        }

        setLoading(true);
        setErrors({});

        try {
            const user = await register({
                name: formData.name,
                email: formData.email,
                password: formData.password,
            });
            navigate(`/users/${user.id}`);
        } catch (error: unknown) {
            setErrors(registerErrors(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Регистрация"
            error={errors.general}
            footer={(
                <>
                    Уже есть аккаунт?{' '}
                    <Link to="/login" className="text-sky-600 hover:underline">
                        Войти
                    </Link>
                </>
            )}
        >
            <form onSubmit={handleSubmit}>
                <AuthField
                    label="Имя"
                    type="text"
                    name="name"
                    value={formData.name}
                    error={errors.name}
                    onChange={handleChange}
                    autoComplete="name"
                />
                <AuthField
                    label="Email"
                    type="email"
                    name="email"
                    value={formData.email}
                    error={errors.email}
                    onChange={handleChange}
                    autoComplete="email"
                />
                <AuthField
                    label="Пароль"
                    type="password"
                    name="password"
                    value={formData.password}
                    error={errors.password}
                    onChange={handleChange}
                    autoComplete="new-password"
                />
                <AuthField
                    label="Подтверждение пароля"
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    error={errors.confirmPassword}
                    onChange={handleChange}
                    autoComplete="new-password"
                    className="mb-6"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-sky-600 py-2.5 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                >
                    {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                </button>
            </form>
        </AuthCard>
    );
}

export default Register;
