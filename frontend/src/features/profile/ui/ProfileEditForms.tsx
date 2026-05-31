import { useRef, type ChangeEvent, type FormEvent, type PointerEvent, type WheelEvent } from 'react';

import type { PasswordChangeData } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";

export type ProfileEditTab = 'profile' | 'password';

export type ProfileFormData = {
    name: string;
    email: string;
    bio: string;
    avatarPositionX: number;
    avatarPositionY: number;
    avatarScale: number;
};

export type ProfileEditMessage = {
    type: 'success' | 'error';
    text: string;
};

const avatarPositionMin = 0;
const avatarPositionMax = 100;
const avatarScaleMin = 1;
const avatarScaleMax = 3;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

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
    onAvatarSettingChange: (name: 'avatarPositionX' | 'avatarPositionY' | 'avatarScale', value: number) => void;
    onCancel: () => void;
};

export function ProfileForm({
    data,
    avatarPreview,
    loading,
    onSubmit,
    onChange,
    onAvatarChange,
    onAvatarSettingChange,
    onCancel,
}: ProfileFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-3">
                <AvatarPositionEditor
                    name={data.name}
                    src={avatarPreview || '/default-avatar.png'}
                    positionX={data.avatarPositionX}
                    positionY={data.avatarPositionY}
                    scale={data.avatarScale}
                    onChange={onAvatarSettingChange}
                />

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Аватар</label>
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={onAvatarChange}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:text-gray-700"
                    />
                    <p className="mt-1 text-xs text-gray-500">JPG, PNG или WebP, максимум 5 МБ.</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <RangeControl
                        label="Масштаб"
                        value={data.avatarScale}
                        min={avatarScaleMin}
                        max={avatarScaleMax}
                        step={0.05}
                        onChange={value => onAvatarSettingChange('avatarScale', value)}
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

function AvatarPositionEditor({
    name,
    src,
    positionX,
    positionY,
    scale,
    onChange,
}: {
    name: string;
    src: string;
    positionX: number;
    positionY: number;
    scale: number;
    onChange: (name: 'avatarPositionX' | 'avatarPositionY' | 'avatarScale', value: number) => void;
}) {
    const pointersRef = useRef(new Map<number, { x: number; y: number }>());
    const dragStartRef = useRef<{
        x: number;
        y: number;
        positionX: number;
        positionY: number;
    } | null>(null);
    const pinchStartRef = useRef<{
        distance: number;
        scale: number;
    } | null>(null);

    const setPosition = (nextX: number, nextY: number) => {
        onChange('avatarPositionX', clamp(nextX, avatarPositionMin, avatarPositionMax));
        onChange('avatarPositionY', clamp(nextY, avatarPositionMin, avatarPositionMax));
    };

    const setScale = (nextScale: number) => {
        onChange('avatarScale', Number(clamp(nextScale, avatarScaleMin, avatarScaleMax).toFixed(2)));
    };

    const pointerDistance = () => {
        const points = Array.from(pointersRef.current.values());
        if (points.length < 2) {
            return 0;
        }

        return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 1) {
            dragStartRef.current = {
                x: event.clientX,
                y: event.clientY,
                positionX,
                positionY,
            };
            pinchStartRef.current = null;
        }

        if (pointersRef.current.size === 2) {
            pinchStartRef.current = {
                distance: pointerDistance(),
                scale,
            };
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!pointersRef.current.has(event.pointerId)) {
            return;
        }

        event.preventDefault();
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size >= 2 && pinchStartRef.current) {
            const distance = pointerDistance();
            if (distance > 0 && pinchStartRef.current.distance > 0) {
                setScale(pinchStartRef.current.scale * (distance / pinchStartRef.current.distance));
            }
            return;
        }

        const dragStart = dragStartRef.current;
        const rect = event.currentTarget.getBoundingClientRect();
        if (!dragStart || rect.width === 0 || rect.height === 0) {
            return;
        }

        const deltaX = ((event.clientX - dragStart.x) / rect.width) * 100;
        const deltaY = ((event.clientY - dragStart.y) / rect.height) * 100;

        setPosition(
            dragStart.positionX - deltaX,
            dragStart.positionY - deltaY,
        );
    };

    const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
        pointersRef.current.delete(event.pointerId);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const remaining = Array.from(pointersRef.current.values());
        pinchStartRef.current = null;

        if (remaining.length === 1) {
            dragStartRef.current = {
                x: remaining[0].x,
                y: remaining[0].y,
                positionX,
                positionY,
            };
        } else {
            dragStartRef.current = null;
        }
    };

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        setScale(scale + direction * 0.08);
    };

    return (
        <div className="flex justify-center">
            <div
                role="application"
                tabIndex={0}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onWheel={handleWheel}
                className="cursor-grab touch-none rounded-full active:cursor-grabbing"
                aria-label="Настройка области аватара"
            >
                <Avatar
                    name={name}
                    src={src}
                    positionX={positionX}
                    positionY={positionY}
                    scale={scale}
                    size="xl"
                    className="border border-gray-200 shadow-sm"
                />
            </div>
        </div>
    );
}

function RangeControl({
    label,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                className="w-full accent-sky-600"
            />
        </label>
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
