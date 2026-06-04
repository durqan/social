import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { applyTheme, getStoredTheme, persistTheme, type ThemeId } from '@/app/themes/theme-storage.js';

type ThemeContextValue = {
    theme: ThemeId;
    setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
    children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme());

    useLayoutEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setTheme = useCallback((nextTheme: ThemeId) => {
        setThemeState(nextTheme);
        persistTheme(nextTheme);
        applyTheme(nextTheme);
    }, []);

    const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);

    if (!context) {
        throw new Error('useTheme must be used inside ThemeProvider');
    }

    return context;
}
