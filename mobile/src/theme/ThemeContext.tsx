import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

import {
  defaultThemeId,
  isThemeId,
  themes,
  type ThemeColors,
  type ThemeId,
} from './themes';

const themeStorageKey = 'social.mobile.theme';

type ThemeContextValue = {
  themeId: ThemeId;
  colors: ThemeColors;
  setThemeId: (themeId: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function initialThemeId(): ThemeId {
  return Appearance.getColorScheme() === 'dark' ? 'classic-dark' : defaultThemeId;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(themeStorageKey)
      .then(storedThemeId => {
        if (!mounted) {
          return;
        }

        if (isThemeId(storedThemeId)) {
          setThemeId(storedThemeId);
        } else if (storedThemeId) {
          AsyncStorage.removeItem(themeStorageKey).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const persistThemeId = useCallback((nextThemeId: ThemeId) => {
    setThemeId(nextThemeId);
    AsyncStorage.setItem(themeStorageKey, nextThemeId).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      colors: themes[themeId],
      setThemeId: persistThemeId,
    }),
    [persistThemeId, themeId],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}

export function useThemeColors() {
  return useTheme().colors;
}
