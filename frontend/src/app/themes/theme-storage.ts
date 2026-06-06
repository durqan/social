export const THEME_STORAGE_KEY = 'social.theme';

export const themes = [
    { id: 'classic-light', name: 'Classic Light', description: 'Чистая светлая тема: максимум читаемости и привычный SaaS‑вайб' },
    { id: 'classic-dark', name: 'Classic Dark', description: 'Спокойная тёмная тема без неона: контрастно, строго, удобно ночью' },
    { id: 'aurora-glass', name: 'Aurora Glass', description: 'Премиальный светлый glassmorphism с aurora‑градиентами' },
    { id: 'midnight-orchid', name: 'Midnight Orchid', description: 'Глубокая ночная тема с фиолетовым свечением' },
    { id: 'sakura-dream', name: 'Sakura Dream', description: 'Нежная японская тема: молочный фон, сакура и тепло' },
    { id: 'neo-tokyo', name: 'Neo Tokyo', description: 'Киберпанк без кислотности: неон, графит и бирюза' },
    { id: 'green-farm', name: 'Green Farm', description: 'Уютная природная тема: ферма, хвоя, тёплый свет' },
    { id: 'ember-wasteland', name: 'Ember Wasteland', description: 'Постапокалипсис: пыль, костёр, ржавый металл' },
    { id: 'amoled-void', name: 'AMOLED Void', description: 'Настоящий чёрный фон, максимум контраста и экономии OLED' },
] as const;

export type ThemeId = typeof themes[number]['id'];

const themeIds = new Set<string>(themes.map(theme => theme.id));
const defaultTheme: ThemeId = 'aurora-glass';
const legacyThemeMap: Record<string, ThemeId> = {
    'liquid-glass': 'aurora-glass',
    light: 'classic-light',
    dark: 'classic-dark',
    ocean: 'aurora-glass',
    forest: 'green-farm',
    sunset: 'ember-wasteland',
    nord: 'midnight-orchid',
    cyberpunk: 'neo-tokyo',
};

export function isThemeId(value: string | null): value is ThemeId {
    return Boolean(value && themeIds.has(value));
}

export function getStoredTheme(): ThemeId {
    if (typeof window === 'undefined') {
        return defaultTheme;
    }

    try {
        const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

        if (isThemeId(storedTheme)) {
            return storedTheme;
        }

        return storedTheme ? legacyThemeMap[storedTheme] ?? defaultTheme : defaultTheme;
    } catch {
        return defaultTheme;
    }
}

export function applyTheme(theme: ThemeId) {
    if (typeof document === 'undefined') {
        return;
    }

    document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: ThemeId) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // localStorage can be unavailable in private or restricted contexts.
    }
}

export function initializeTheme() {
    applyTheme(getStoredTheme());
}
