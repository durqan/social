import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
    secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
    ghost: 'text-gray-600 hover:bg-gray-100 disabled:opacity-50',
};

export const Button = ({ variant = 'primary', className = '', children, ...props }: ButtonProps) => (
    <button
        className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer ${variants[variant]} ${className}`}
        {...props}
    >
        {children}
    </button>
);
