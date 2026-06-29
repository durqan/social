import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';

import { getApiError, getApiStatus, getUploadErrorMessage } from "@/shared/api/errors.js";
import { userService } from "@/shared/api/userService.js";
import type { PasswordChangeData, ProfileContextType } from "@/shared/types/domain.js";
import { validateAvatarFile } from "@/shared/utils/uploadValidation.js";
import {
    PasswordForm,
    ProfileEditStatus,
    ProfileEditTabs,
    ProfileForm,
    type ProfileEditMessage,
    type ProfileEditTab,
    type ProfileFormData,
} from "@/features/profile/ui/ProfileEditForms.js";
import { ThemeSettings } from "@/app/themes/ThemeSettings.js";
import { NotificationSettings } from "@/features/profile/components/NotificationSettings.js";

const initialPasswordData: PasswordChangeData = {
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
};

function ProfileEdit() {
    const { user, setUser } = useOutletContext<ProfileContextType>();
    const navigate = useNavigate();
    const { id } = useParams();

    const [formData, setFormData] = useState<ProfileFormData>({
        name: user?.name || '',
        email: user?.email || '',
        bio: user?.bio || '',
        avatarPositionX: user?.avatarPositionX ?? 50,
        avatarPositionY: user?.avatarPositionY ?? 50,
        avatarScale: user?.avatarScale ?? 1,
    });
    const [passwordData, setPasswordData] = useState<PasswordChangeData>(initialPasswordData);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<ProfileEditMessage | null>(null);
    const [activeTab, setActiveTab] = useState<ProfileEditTab>('profile');

    const setSuccess = (text: string) => setMessage({ type: 'success', text });
    const setError = (text: string) => setMessage({ type: 'error', text });

    const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({ ...prev, [event.target.name]: event.target.value }));
        setMessage(null);
    };

    const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
        setPasswordData(prev => ({ ...prev, [event.target.name]: event.target.value }));
        setMessage(null);
    };

    const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const validationError = validateAvatarFile(file);
        if (validationError) {
            setAvatarFile(null);
            setError(validationError);
            event.target.value = '';
            return;
        }

        setMessage(null);
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
        setFormData(prev => ({
            ...prev,
            avatarPositionX: 50,
            avatarPositionY: 50,
            avatarScale: 1,
        }));
    };

    const handleAvatarSettingChange = (name: 'avatarPositionX' | 'avatarPositionY' | 'avatarScale', value: number) => {
        setFormData(prev => ({ ...prev, [name]: value }));
        setMessage(null);
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            if (avatarFile) {
                await userService.uploadAvatar(user.id!, avatarFile);
            }

            const updatedUser = await userService.updateUser(user.id!, {
                name: formData.name,
                email: formData.email,
                bio: formData.bio,
                avatar_position_x: formData.avatarPositionX,
                avatar_position_y: formData.avatarPositionY,
                avatar_scale: formData.avatarScale,
            });
            setUser(updatedUser);
            setSuccess('Профиль успешно обновлен!');
        } catch (err: unknown) {
            const status = getApiStatus(err);
            const apiError = getApiError(err);

            if (avatarFile && [400, 413, 415].includes(status || 0)) {
                setError(getUploadErrorMessage(err, 'Не удалось загрузить аватар'));
            } else if (status === 409) {
                setError('Пользователь с таким email уже существует');
            } else if (status === 400) {
                setError(apiError.error || apiError.message || 'Некорректные данные');
            } else {
                setError(apiError.error || apiError.message || 'Ошибка при обновлении');
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (event: FormEvent) => {
        event.preventDefault();

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setError('Новые пароли не совпадают');
            return;
        }

        if (passwordData.newPassword.length < 6) {
            setError('Новый пароль должен быть минимум 6 символов');
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            await userService.changePassword(user.id!, {
                current_password: passwordData.oldPassword,
                new_password: passwordData.newPassword,
            });

            setSuccess('Пароль успешно изменен!');
            setPasswordData(initialPasswordData);
        } catch (err: unknown) {
            const status = getApiStatus(err);
            const apiError = getApiError(err);
            setError(status === 401 ? 'Неверный старый пароль' : apiError.message || 'Ошибка при смене пароля');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <ProfileEditTabs activeTab={activeTab} onChange={setActiveTab} />

                <div className="p-4 sm:p-6">
                    <ProfileEditStatus message={message} />

                    {activeTab === 'profile' && (
                        <ProfileForm
                            data={formData}
                            avatarPreview={avatarPreview}
                            loading={loading}
                            onSubmit={handleSubmit}
                            onChange={handleChange}
                            onAvatarChange={handleAvatarChange}
                            onAvatarSettingChange={handleAvatarSettingChange}
                            onCancel={() => navigate(`/profile/${id}`)}
                        />
                    )}

                    {activeTab === 'password' && (
                        <PasswordForm
                            data={passwordData}
                            loading={loading}
                            onSubmit={handlePasswordSubmit}
                            onChange={handlePasswordChange}
                        />
                    )}

                    {activeTab === 'theme' && (
                        <ThemeSettings />
                    )}

                    {activeTab === 'notifications' && (
                        <NotificationSettings />
                    )}
                </div>
            </div>
        </div>
    );
}

export default ProfileEdit;
