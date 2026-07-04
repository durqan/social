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

import {
  defaultThemeId,
  isThemeId,
  themes,
  type ThemeColors,
  type ThemeId,
} from './themes';
import {
  applyTypographyScale,
  isTextSizeId,
  textSizeOptions,
  type TextSizeId,
} from './layout';

const themeStorageKey = 'social.mobile.theme';
const textSizeStorageKey = 'social.mobile.text_size';
const defaultTextSizeId: TextSizeId = 'standard';

type ThemeContextValue = {
  themeId: ThemeId;
  colors: ThemeColors;
  setThemeId: (themeId: ThemeId) => void;
  textSizeId: TextSizeId;
  setTextSizeId: (textSizeId: TextSizeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function initialThemeId(): ThemeId {
  return defaultThemeId;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId);
  const [textSizeId, setTextSizeId] =
    useState<TextSizeId>(defaultTextSizeId);

  useEffect(() => {
    let mounted = true;

    Promise.all([
      AsyncStorage.getItem(themeStorageKey),
      AsyncStorage.getItem(textSizeStorageKey),
    ])
      .then(([storedThemeId, storedTextSizeId]) => {
        if (!mounted) {
          return;
        }

        if (isThemeId(storedThemeId)) {
          setThemeId(storedThemeId);
        } else if (storedThemeId) {
          AsyncStorage.removeItem(themeStorageKey).catch(() => undefined);
        }

        if (isTextSizeId(storedTextSizeId)) {
          setTextSizeId(storedTextSizeId);
        } else if (storedTextSizeId) {
          AsyncStorage.removeItem(textSizeStorageKey).catch(() => undefined);
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

  const persistTextSizeId = useCallback((nextTextSizeId: TextSizeId) => {
    setTextSizeId(nextTextSizeId);
    AsyncStorage.setItem(textSizeStorageKey, nextTextSizeId).catch(
      () => undefined,
    );
  }, []);

  applyTypographyScale(textSizeOptions[textSizeId].scale);

  const value = useMemo(() => {
    const safeThemeId = isThemeId(themeId) ? themeId : defaultThemeId;
    const safeColors = themes[safeThemeId] ?? themes[defaultThemeId];

    return {
      themeId: safeThemeId,
      colors: safeColors,
      setThemeId: persistThemeId,
      textSizeId,
      setTextSizeId: persistTextSizeId,
    };
  }, [persistTextSizeId, persistThemeId, textSizeId, themeId]);

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
  return useTheme().colors ?? themes[defaultThemeId];
}
