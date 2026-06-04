import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Theme = 'classic' | 'liquidGlass' | 'midnight' | 'softBlue';

interface SettingsContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themes: { value: Theme; label: string }[];
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const STORAGE_KEY = 'app-theme';
const DEFAULT_THEME: Theme = 'classic';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'classic', label: 'Классическая' },
  { value: 'liquidGlass', label: 'Liquid Glass' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'softBlue', label: 'Soft Blue' },
];

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved && THEMES.some(t => t.value === saved) ? saved : DEFAULT_THEME;
  });

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  // Apply to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const value: SettingsContextType = {
    theme,
    setTheme,
    themes: THEMES,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}
