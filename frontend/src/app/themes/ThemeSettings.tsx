import { themes } from '@/app/themes/theme-storage.js';
import { useTheme } from '@/app/themes/ThemeProvider.js';

export function ThemeSettings() {
    const { theme: activeTheme, setTheme } = useTheme();

    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-[var(--app-text-primary)]">Тема оформления</h2>
                <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
                    Тема сохраняется локально и применяется сразу, без перезагрузки страницы.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {themes.map(theme => {
                    const selected = activeTheme === theme.id;

                    return (
                        <button
                            key={theme.id}
                            type="button"
                            data-theme={theme.id}
                            onClick={() => setTheme(theme.id)}
                            className={`group rounded-2xl border p-3 text-left transition ${
                                selected
                                    ? 'border-[var(--app-accent)] ring-2 ring-[var(--app-focus-ring)]'
                                    : 'border-[var(--app-border)] hover:border-[var(--app-border-strong)]'
                            }`}
                            aria-pressed={selected}
                        >
                            <span className="block overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] shadow-sm">
                                <span className="block h-8 bg-[var(--app-profile-cover)]" />
                                <span className="block space-y-2 p-2">
                                    <span className="flex items-center gap-2">
                                        <span className="h-5 w-5 rounded-full bg-[var(--app-accent)]" />
                                        <span className="h-2 flex-1 rounded-full bg-[var(--app-text-primary)] opacity-85" />
                                    </span>
                                    <span className="grid grid-cols-4 gap-1">
                                        <span className="h-5 rounded-md bg-[var(--app-surface)]" />
                                        <span className="h-5 rounded-md bg-[var(--app-card)]" />
                                        <span className="h-5 rounded-md bg-[var(--app-success)]" />
                                        <span className="h-5 rounded-md bg-[var(--app-warning)]" />
                                    </span>
                                    <span className="block h-6 rounded-lg border border-[var(--app-message-own-border)] bg-[var(--app-message-own-bg)]" />
                                </span>
                            </span>
                            <span className="mt-3 flex items-center justify-between gap-2">
                                <span className="min-w-0">
                                    <span className="block font-semibold text-[var(--app-text-primary)]">{theme.name}</span>
                                    <span className="block truncate text-xs text-[var(--app-text-secondary)]">{theme.description}</span>
                                </span>
                                <span className={`h-3 w-3 rounded-full ${selected ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-border-strong)]'}`} />
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
