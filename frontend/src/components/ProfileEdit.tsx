import { useState } from 'react';
import { useOutletContext, useNavigate, useParams } from 'react-router-dom';

import type {
    User,
    ProfileContextType,
    PasswordChangeData,
} from '../types.js';

import { userService } from '../services/userService.js';
import { getApiError, getApiStatus } from '../api/errors.js';

function ProfileEdit() {
    const { user, setUser } =
        useOutletContext<ProfileContextType>();

    const navigate = useNavigate();
    const { id } = useParams();

    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        bio: user?.bio || '',
    });

    const [passwordData, setPasswordData] =
        useState<PasswordChangeData>({
            oldPassword: '',
            newPassword: '',
            confirmPassword: '',
        });

    const [avatarFile, setAvatarFile] =
        useState<File | null>(null);

    const [avatarPreview, setAvatarPreview] =
        useState<string | null>(
            user?.avatar || null
        );

    const [loading, setLoading] =
        useState(false);

    const [message, setMessage] =
        useState<{
            type: 'success' | 'error';
            text: string;
        } | null>(null);

    const [activeTab, setActiveTab] =
        useState<'profile' | 'password'>(
            'profile'
        );

    const handleChange = (
        e: React.ChangeEvent<
            HTMLInputElement |
            HTMLTextAreaElement
        >
    ) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });

        setMessage(null);
    };

    const handlePasswordChange = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setPasswordData({
            ...passwordData,
            [e.target.name]: e.target.value,
        });

        setMessage(null);
    };

    const handleAvatarChange = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = e.target.files?.[0];

        if (!file) return;

        setAvatarFile(file);

        setAvatarPreview(
            URL.createObjectURL(file)
        );
    };

    const handleSubmit = async (
        e: React.FormEvent
    ) => {
        e.preventDefault();

        setLoading(true);
        setMessage(null);

        try {
            if (avatarFile) {
                await userService.uploadAvatar(
                    user.id!,
                    avatarFile,
                );
            }

            const updatedUser =
                await userService.updateUser(
                    user.id!,
                    formData,
                );

            setUser(updatedUser);

            setMessage({
                type: 'success',
                text:
                    'Профиль успешно обновлен!',
            });

        } catch (err: unknown) {
            const status =
                getApiStatus(err);

            const apiError =
                getApiError(err);

            if (status === 409) {
                setMessage({
                    type: 'error',
                    text:
                        'Пользователь с таким email уже существует',
                });

            } else if (status === 400) {
                setMessage({
                    type: 'error',
                    text: 'Некорректные данные',
                });

            } else {
                setMessage({
                    type: 'error',
                    text:
                        apiError.message ||
                        'Ошибка при обновлении',
                });
            }

        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (
        e: React.FormEvent
    ) => {
        e.preventDefault();

        if (
            passwordData.newPassword !==
            passwordData.confirmPassword
        ) {
            setMessage({
                type: 'error',
                text:
                    'Новые пароли не совпадают',
            });

            return;
        }

        if (
            passwordData.newPassword.length < 6
        ) {
            setMessage({
                type: 'error',
                text:
                    'Новый пароль должен быть минимум 6 символов',
            });

            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            await userService.changePassword(
                user.id!,
                {
                    current_password:
                    passwordData.oldPassword,

                    new_password:
                    passwordData.newPassword,
                },
            );

            setMessage({
                type: 'success',
                text:
                    'Пароль успешно изменен!',
            });

            setPasswordData({
                oldPassword: '',
                newPassword: '',
                confirmPassword: '',
            });

        } catch (err: unknown) {
            const status =
                getApiStatus(err);

            const apiError =
                getApiError(err);

            if (status === 401) {
                setMessage({
                    type: 'error',
                    text:
                        'Неверный старый пароль',
                });

            } else {
                setMessage({
                    type: 'error',
                    text:
                        apiError.message ||
                        'Ошибка при смене пароля',
                });
            }

        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">

                <div className="border-b border-gray-200">
                    <div className="flex">

                        <button
                            onClick={() =>
                                setActiveTab('profile')
                            }
                            className={`flex-1 px-2 py-3 text-sm font-medium transition-colors sm:px-4 ${
                                activeTab === 'profile'
                                    ? 'text-sky-700 border-b-2 border-sky-600'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Редактировать профиль
                        </button>

                        <button
                            onClick={() =>
                                setActiveTab('password')
                            }
                            className={`flex-1 px-2 py-3 text-sm font-medium transition-colors sm:px-4 ${
                                activeTab === 'password'
                                    ? 'text-sky-700 border-b-2 border-sky-600'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Сменить пароль
                        </button>

                    </div>
                </div>

                <div className="p-4 sm:p-6">

                    {message && (
                        <div className={`mb-4 p-3 rounded-lg ${
                            message.type === 'success'
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                            {message.text}
                        </div>
                    )}

                    {activeTab === 'profile' && (
                        <form
                            onSubmit={handleSubmit}
                            className="space-y-4"
                        >

                            <div className="space-y-3">

                                <div className="flex justify-center">
                                    <img
                                        src={
                                            avatarPreview ||
                                            '/default-avatar.png'
                                        }
                                        alt="Avatar preview"
                                        className="w-28 h-28 rounded-full object-cover border"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Аватар
                                    </label>

                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleAvatarChange}
                                        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:text-gray-700"
                                    />
                                </div>

                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Имя
                                </label>

                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    className="app-input px-4 py-2"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Email
                                </label>

                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="app-input px-4 py-2"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    О себе
                                </label>

                                <textarea
                                    name="bio"
                                    value={formData.bio}
                                    onChange={handleChange}
                                    rows={4}
                                    maxLength={150}
                                    className="app-input px-4 py-2 resize-none"
                                    placeholder="Расскажите о себе..."
                                />

                                <p className="text-xs text-gray-500 mt-1">
                                    {formData.bio.length}/150 символов
                                </p>
                            </div>

                            <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:gap-3">

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-xl bg-sky-600 px-6 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer sm:w-auto"
                                >
                                    {loading
                                        ? 'Сохранение...'
                                        : 'Сохранить изменения'}
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        navigate(
                                            `/profile/${id}`
                                        )
                                    }
                                    className="w-full rounded-xl bg-gray-100 px-6 py-2 text-gray-800 transition hover:bg-gray-200 cursor-pointer sm:w-auto"
                                >
                                    Отмена
                                </button>

                            </div>

                        </form>
                    )}

                    {activeTab === 'password' && (
                        <form
                            onSubmit={handlePasswordSubmit}
                            className="space-y-4"
                        >

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Старый пароль
                                </label>

                                <input
                                    type="password"
                                    name="oldPassword"
                                    value={passwordData.oldPassword}
                                    onChange={handlePasswordChange}
                                    required
                                    className="app-input px-4 py-2"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Новый пароль
                                </label>

                                <input
                                    type="password"
                                    name="newPassword"
                                    value={passwordData.newPassword}
                                    onChange={handlePasswordChange}
                                    required
                                    minLength={6}
                                    className="app-input px-4 py-2"
                                />

                                <p className="text-xs text-gray-500 mt-1">
                                    Минимум 6 символов
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Подтверждение нового пароля
                                </label>

                                <input
                                    type="password"
                                    name="confirmPassword"
                                    value={passwordData.confirmPassword}
                                    onChange={handlePasswordChange}
                                    required
                                    className="app-input px-4 py-2"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-xl bg-sky-600 px-6 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer sm:w-auto"
                                >
                                    {loading
                                        ? 'Смена пароля...'
                                        : 'Сменить пароль'}
                                </button>
                            </div>

                        </form>
                    )}

                </div>
            </div>
        </div>
    );
}

export default ProfileEdit;
