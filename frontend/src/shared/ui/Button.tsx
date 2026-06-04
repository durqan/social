import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover disabled:opacity-50',
    secondary: 'bg-surface-hover text-text hover:bg-surface disabled:opacity-50',
    danger: 'bg-danger text-white hover:bg-danger disabled:opacity-50',
    ghost: 'text-text-secondary hover:bg-surface-hover disabled:opacity-50',
};

export const Button = ({ variant = 'primary', className = '', children, ...props }: ButtonProps) => (
    <button
        className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition cursor-pointer ${variants[variant]} ${className}`}
        {...props}
    >
        {children}
    </button>
);
