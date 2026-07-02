import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

type LegalPageLayoutProps = {
    title: string;
    updated: string;
    children: ReactNode;
};

export function LegalPageLayout({ title, updated, children }: LegalPageLayoutProps) {
    return (
        <main className="min-h-screen bg-slate-50 text-slate-900">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12 lg:py-16">
                <header className="flex flex-col gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-2xl">
                        <Link
                            to="/"
                            className="text-sm font-semibold uppercase text-sky-700"
                        >
                            Durqan
                        </Link>
                        <h1 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl">{title}</h1>
                        <p className="mt-3 text-sm text-slate-600">Last updated: {updated}</p>
                    </div>
                    <a
                        href="mailto:duircianos@icloud.com"
                        className="inline-flex w-fit items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-sky-500 hover:text-sky-700"
                    >
                        Contact support
                    </a>
                </header>
                <article className="legal-document space-y-8 text-base leading-7 text-slate-700">
                    {children}
                </article>
            </div>
        </main>
    );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
            {children}
        </section>
    );
}

export function LegalList({ children }: { children: ReactNode }) {
    return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}
