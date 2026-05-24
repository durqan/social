import type { ReactNode } from 'react';

type AuthCardProps = {
    title: string;
    error?: string | null;
    footer: ReactNode;
    children: ReactNode;
};

export function AuthCard({ title, error, footer, children }: AuthCardProps) {
    return (
        <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center px-4 py-6">
            <div className="app-card w-full max-w-sm p-5 sm:p-8">
                <h2 className="text-2xl font-semibold tracking-tight text-center mb-6">
                    {title}
                </h2>

                {error && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                        {error}
                    </div>
                )}

                {children}

                <p className="mt-4 text-center text-sm text-gray-600 sm:text-base">
                    {footer}
                </p>
            </div>
        </div>
    );
}
