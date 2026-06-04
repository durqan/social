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
                    <div className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-danger">
                        {error}
                    </div>
                )}

                {children}

                <p className="mt-4 text-center text-sm text-text-secondary sm:text-base">
                    {footer}
                </p>
            </div>
        </div>
    );
}
