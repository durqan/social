import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
    primary: 'app-button-primary disabled:opacity-50',
    secondary: 'app-button-secondary disabled:opacity-50',
    danger: 'app-button-danger disabled:opacity-50',
    ghost: 'app-button-ghost disabled:opacity-50',
};

export const Button = ({ variant = 'primary', className = '', children, ...props }: ButtonProps) => (
    <button
        className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition cursor-pointer ${variants[variant]} ${className}`}
        {...props}
    >
        {children}
    </button>
);
