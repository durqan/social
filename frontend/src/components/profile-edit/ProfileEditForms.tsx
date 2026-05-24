import type { ChangeEvent, FormEvent } from 'react';

import type { PasswordChangeData } from '../../types.js';

export type ProfileEditTab = 'profile' | 'password';

export type ProfileFormData = {
    name: string;
    email: string;
    bio: string;
};

export type ProfileEditMessage = {
    type: 'success' | 'error';
    text: string;
};

type TabsProps = {
    activeTab: ProfileEditTab;
    onChange: (tab: ProfileEditTab) => void;
};

export function ProfileEditTabs({ activeTab, onChange }: TabsProps) {
    const tabClass = (tab: ProfileEditTab) => (
        `flex-1 px-2 py-3 text-sm font-medium transition-colors sm:px-4 ${
            activeTab === tab
                ? 'text-sky-700 border-b-2 border-sky-600'
                : 'text-gray-500 hover:text-gray-700'
        }`
    );

    return (
        <div className="border-b border-gray-200">
            <div className="flex">
                <button onClick={() => onChange('profile')} className={tabClass('profile')}>
                    Редактировать профиль
                </button>
                <button onClick={() => onChange('password')} className={tabClass('password')}>
                    Сменить пароль
                </button>
            </div>
        </div>
    );
}

export function ProfileEditStatus({ message }: { message: ProfileEditMessage | null }) {
    if (!message) {
        return null;
    }

    return (
        <div className={`mb-4 p-3 rounded-lg ${
            message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
            {message.text}
        </div>
    );
}

type ProfileFormProps = {
    data: ProfileFormData;
    avatarPreview: string | null;
    loading: boolean;
    onSubmit: (event: FormEvent) => void;
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onCancel: () => void;
};

export function ProfileForm({
    data,
    avatarPreview,
    loading,
    onSubmit,
    onChange,
    onAvatarChange,
    onCancel,
}: ProfileFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-3">
                <div className="flex justify-center">
                    <img
                        src={avatarPreview || '/default-avatar.png'}
                        alt="Avatar preview"
                        className="w-28 h-28 rounded-full object-cover border"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Аватар</label>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={onAvatarChange}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:text-gray-700"
                    />
                </div>
            </div>

            <LabeledInput label="Имя" name="name" value={data.name} onChange={onChange} />
            <LabeledInput label="Email" name="email" type="email" value={data.email} onChange={onChange} />

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">О себе</label>
                <textarea
                    name="bio"
                    value={data.bio}
                    onChange={onChange}
                    rows={4}
                    maxLength={150}
                    className="app-input px-4 py-2 resize-none"
                    placeholder="Расскажите о себе..."
                />
                <p className="text-xs text-gray-500 mt-1">{data.bio.length}/150 символов</p>
            </div>

            <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:gap-3">
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-sky-600 px-6 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer sm:w-auto"
                >
                    {loading ? 'Сохранение...' : 'Сохранить изменения'}
                </button>

                <button
                    type="button"
                    onClick={onCancel}
                    className="w-full rounded-xl bg-gray-100 px-6 py-2 text-gray-800 transition hover:bg-gray-200 cursor-pointer sm:w-auto"
                >
                    Отмена
                </button>
            </div>
        </form>
    );
}

type PasswordFormProps = {
    data: PasswordChangeData;
    loading: boolean;
    onSubmit: (event: FormEvent) => void;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function PasswordForm({ data, loading, onSubmit, onChange }: PasswordFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <LabeledInput
                label="Старый пароль"
                name="oldPassword"
                type="password"
                value={data.oldPassword}
                onChange={onChange}
                required
            />

            <div>
                <LabeledInput
                    label="Новый пароль"
                    name="newPassword"
                    type="password"
                    value={data.newPassword}
                    onChange={onChange}
                    required
                    minLength={6}
                />
                <p className="text-xs text-gray-500 mt-1">Минимум 6 символов</p>
            </div>

            <LabeledInput
                label="Подтверждение нового пароля"
                name="confirmPassword"
                type="password"
                value={data.confirmPassword}
                onChange={onChange}
                required
            />

            <div className="flex gap-3 pt-4">
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-sky-600 px-6 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer sm:w-auto"
                >
                    {loading ? 'Смена пароля...' : 'Сменить пароль'}
                </button>
            </div>
        </form>
    );
}

type LabeledInputProps = {
    label: string;
    name: string;
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    type?: string;
    required?: boolean;
    minLength?: number;
};

function LabeledInput({
    label,
    name,
    value,
    onChange,
    type = 'text',
    required,
    minLength,
}: LabeledInputProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input
                type={type}
                name={name}
                value={value}
                onChange={onChange}
                required={required}
                minLength={minLength}
                className="app-input px-4 py-2"
            />
        </div>
    );
}
