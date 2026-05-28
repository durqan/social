import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';

import { getApiError, getApiStatus } from "@/shared/api/errors.js";
import { userService } from "@/shared/api/userService.js";
import type { PasswordChangeData, ProfileContextType } from "@/shared/types/domain.js";
import {
    PasswordForm,
    ProfileEditStatus,
    ProfileEditTabs,
    ProfileForm,
    type ProfileEditMessage,
    type ProfileEditTab,
    type ProfileFormData,
} from "@/features/profile/ui/ProfileEditForms.js";

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

        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            if (avatarFile) {
                await userService.uploadAvatar(user.id!, avatarFile);
            }

            const updatedUser = await userService.updateUser(user.id!, formData);
            setUser(updatedUser);
            setSuccess('Профиль успешно обновлен!');
        } catch (err: unknown) {
            const status = getApiStatus(err);
            const apiError = getApiError(err);

            if (status === 409) {
                setError('Пользователь с таким email уже существует');
            } else if (status === 400) {
                setError('Некорректные данные');
            } else {
                setError(apiError.message || 'Ошибка при обновлении');
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
                </div>
            </div>
        </div>
    );
}

export default ProfileEdit;
