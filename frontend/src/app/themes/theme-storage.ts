export const THEME_STORAGE_KEY = 'social.theme';

export const themes = [
    { id: 'liquid-glass', name: 'Liquid Glass', description: 'Текущая стеклянная тема' },
    { id: 'light', name: 'Light', description: 'Светлая нейтральная тема' },
    { id: 'dark', name: 'Dark', description: 'Тёмная контрастная тема' },
    { id: 'ocean', name: 'Ocean', description: 'Свежая морская палитра' },
    { id: 'forest', name: 'Forest', description: 'Спокойная природная палитра' },
    { id: 'sunset', name: 'Sunset', description: 'Тёплая закатная тема' },
    { id: 'nord', name: 'Nord', description: 'Холодная северная тема' },
    { id: 'cyberpunk', name: 'Cyberpunk', description: 'Контрастная неоновая тема' },
] as const;

export type ThemeId = typeof themes[number]['id'];

const themeIds = new Set<string>(themes.map(theme => theme.id));
const defaultTheme: ThemeId = 'liquid-glass';

export function isThemeId(value: string | null): value is ThemeId {
    return Boolean(value && themeIds.has(value));
}

export function getStoredTheme(): ThemeId {
    if (typeof window === 'undefined') {
        return defaultTheme;
    }

    try {
        const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
        return isThemeId(storedTheme) ? storedTheme : defaultTheme;
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
