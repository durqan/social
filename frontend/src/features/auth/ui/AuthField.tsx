import type { ChangeEventHandler } from 'react';

type AuthFieldProps = {
    label: string;
    name: string;
    type: string;
    value: string;
    error?: string;
    autoComplete?: string;
    className?: string;
    onChange: ChangeEventHandler<HTMLInputElement>;
};

export function AuthField({
    label,
    name,
    type,
    value,
    error,
    autoComplete,
    className = 'mb-4',
    onChange,
}: AuthFieldProps) {
    return (
        <div className={className}>
            <label className="block text-text-secondary mb-2">{label}</label>
            <input
                type={type}
                name={name}
                value={value}
                onChange={onChange}
                autoComplete={autoComplete}
                required
                className={`app-input px-3 py-2 ${error ? 'border-red-500' : ''}`}
            />
            {error && (
                <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
        </div>
    );
}
