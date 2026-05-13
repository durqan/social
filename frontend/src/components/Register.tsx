import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService.js';
import {wsService} from "../services/ws.js";

function Register() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    const [errors, setErrors] = useState<{
        name?: string;
        email?: string;
        password?: string;
        confirmPassword?: string;
        general?: string;
    }>({});
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        if (errors[e.target.name as keyof typeof errors]) {
            setErrors({
                ...errors,
                [e.target.name]: undefined
            });
        }
    };

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();

        const newErrors: typeof errors = {};

        if (formData.password !== formData.confirmPassword) {
            newErrors.confirmPassword = 'Пароли не совпадают';
        }

        if (formData.password.length < 6) {
            newErrors.password = 'Пароль должен содержать минимум 6 символов';
        }

        if (!formData.email.includes('@')) {
            newErrors.email = 'Введите корректный email';
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setLoading(true);
        setErrors({});

        try {
            const response = await authService.register({
                name: formData.name,
                email: formData.email,
                password: formData.password
            });
            wsService.connect();
            navigate(`/users/${response.user.id}`);
        } catch (err: any) {
            if (err.response?.data?.error) {
                const errorMessage = err.response.data.error;

                if (errorMessage.includes('Password') && errorMessage.includes('min')) {
                    setErrors({ password: 'Пароль слишком короткий (минимум 6 символов)' });
                }
                else if (errorMessage.includes('Email')) {
                    setErrors({ email: 'Некорректный формат email' });
                }
                else if (errorMessage.includes('Name')) {
                    setErrors({ name: 'Имя обязательно для заполнения' });
                }
                else if (errorMessage.includes('duplicate') || errorMessage.includes('already exists')) {
                    setErrors({ email: 'Пользователь с таким email уже существует' });
                }
                else {
                    setErrors({ general: errorMessage });
                }
            }
            else if (err.response?.data?.message) {
                const message = err.response.data.message;
                if (message.includes('email') || message.includes('Email')) {
                    setErrors({ email: message });
                } else if (message.includes('password') || message.includes('Password')) {
                    setErrors({ password: message });
                } else {
                    setErrors({ general: message });
                }
            }
            else if (err.message === 'Network Error') {
                setErrors({ general: 'Ошибка сети. Проверьте подключение к серверу' });
            }
            else {
                setErrors({ general: 'Произошла неизвестная ошибка. Попробуйте позже' });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="bg-white p-8 rounded-lg shadow-md w-96">
                <h2 className="text-2xl font-bold text-center mb-6">Регистрация</h2>

                {errors.general && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
                        {errors.general}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 mb-2">Имя</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors.name ? 'border-red-500' : ''
                            }`}
                        />
                        {errors.name && (
                            <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                        )}
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 mb-2">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors.email ? 'border-red-500' : ''
                            }`}
                        />
                        {errors.email && (
                            <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                        )}
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 mb-2">Пароль</label>
                        <input
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors.password ? 'border-red-500' : ''
                            }`}
                        />
                        {errors.password && (
                            <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                        )}
                    </div>

                    <div className="mb-6">
                        <label className="block text-gray-700 mb-2">Подтверждение пароля</label>
                        <input
                            type="password"
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            required
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors.confirmPassword ? 'border-red-500' : ''
                            }`}
                        />
                        {errors.confirmPassword && (
                            <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 transition disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                    </button>
                </form>

                <p className="mt-4 text-center text-gray-600">
                    Уже есть аккаунт?{' '}
                    <a href="/login" className="text-blue-500 hover:underline">
                        Войти
                    </a>
                </p>
            </div>
        </div>
    );
}

export default Register;