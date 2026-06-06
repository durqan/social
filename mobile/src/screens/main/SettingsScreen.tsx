import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useTheme, useThemeColors } from '../../theme/ThemeContext';
import { themeOrder, themes, type ThemeColors } from '../../theme/themes';

export default function SettingsScreen() {
  const { logout, user } = useAuth();
  const { themeId, setThemeId } = useTheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.title}>Аккаунт</Text>
        <Text style={styles.text}>
          {user?.name || user?.email || 'Ваш профиль'} сейчас активен на этом
          устройстве.
        </Text>
        <AppButton
          title="Выйти"
          variant="danger"
          loading={loggingOut}
          onPress={handleLogout}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Безопасность</Text>
        <Text style={styles.text}>
          При выходе приложение завершит текущую сессию и вернет вас на экран
          входа.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Тема оформления</Text>
        <Text style={styles.text}>
          Палитра применяется сразу и адаптирована под мобильный интерфейс.
        </Text>
        <View style={styles.themeGrid}>
          {themeOrder.map(nextThemeId => {
            const theme = themes[nextThemeId];
            const selected = themeId === nextThemeId;

            return (
              <Pressable
                key={theme.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.themeOption,
                  selected && styles.themeOptionSelected,
                  pressed && styles.themeOptionPressed,
                ]}
                onPress={() => setThemeId(theme.id)}
              >
                <View style={styles.themePreview}>
                  <View
                    style={[
                      styles.themePreviewBand,
                      { backgroundColor: theme.profileCover },
                    ]}
                  />
                  <View style={styles.themePreviewBody}>
                    <View
                      style={[
                        styles.themePreviewDot,
                        { backgroundColor: theme.accent },
                      ]}
                    />
                    <View
                      style={[
                        styles.themePreviewLine,
                        { backgroundColor: theme.text },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.themeMeta}>
                  <Text style={styles.themeName} numberOfLines={1}>
                    {theme.name}
                  </Text>
                  <Text style={styles.themeDescription} numberOfLines={2}>
                    {theme.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.themeMark,
                    selected && styles.themeMarkSelected,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  text: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  themeGrid: {
    gap: 10,
  },
  themeOption: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.cardMuted,
    padding: 10,
  },
  themeOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.selected,
  },
  themeOptionPressed: {
    backgroundColor: colors.pressed,
  },
  themePreview: {
    width: 58,
    height: 58,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  themePreviewBand: {
    height: 20,
  },
  themePreviewBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  themePreviewDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  themePreviewLine: {
    width: 34,
    height: 5,
    borderRadius: 999,
    opacity: 0.76,
  },
  themeMeta: {
    flex: 1,
    gap: 3,
  },
  themeName: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  themeDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  themeMark: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  themeMarkSelected: {
    backgroundColor: colors.accent,
  },
});
