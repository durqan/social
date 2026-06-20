import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyRound, LogOut } from 'lucide-react-native';

import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, SuccessBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useTheme, useThemeColors } from '../../theme/ThemeContext';
import { themeOrder, themes, type ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';

type SecurityBusyAction = 'password';

export default function SettingsScreen() {
  const { logout, user } = useAuth();
  const { themeId, setThemeId } = useTheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityBusy, setSecurityBusy] = useState<SecurityBusyAction | null>(
    null,
  );
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  async function handleChangePassword() {
    if (!user?.id) {
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setSecurityError('Заполните все поля смены пароля.');
      return;
    }
    if (newPassword.length < 6) {
      setSecurityError('Новый пароль должен быть не короче 6 символов.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityError('Подтверждение пароля не совпадает.');
      return;
    }

    setSecurityBusy('password');
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      await userApi.changePassword(user.id, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecuritySuccess('Пароль изменен.');
    } catch (apiError) {
      setSecurityError(securityErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  const securityBusyNow = Boolean(securityBusy);

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
          icon={LogOut}
          loading={loggingOut}
          onPress={handleLogout}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Безопасность</Text>
        <ErrorBanner message={securityError} />
        <SuccessBanner message={securitySuccess} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Смена пароля</Text>
          <TextField
            label="Текущий пароль"
            value={currentPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            onChangeText={setCurrentPassword}
          />
          <TextField
            label="Новый пароль"
            value={newPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="password-new"
            onChangeText={setNewPassword}
          />
          <TextField
            label="Повторите новый пароль"
            value={confirmPassword}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="password-new"
            onChangeText={setConfirmPassword}
          />
          <AppButton
            title="Сменить пароль"
            icon={KeyRound}
            loading={securityBusy === 'password'}
            disabled={securityBusyNow}
            onPress={handleChangePassword}
          />
        </View>
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

function securityErrorMessage(error: unknown) {
  return getApiErrorMessage(error);
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      ...typography.h3,
      color: colors.text,
    },
    text: {
      ...typography.caption,
      color: colors.muted,
    },
    section: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    sectionTitle: {
      ...typography.body,
      color: colors.text,
      fontWeight: '800',
    },
    actions: {
      gap: spacing.sm,
    },
    themeGrid: {
      gap: spacing.sm,
    },
    themeOption: {
      minHeight: 86,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.cardMuted,
      padding: spacing.md,
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
      borderRadius: radius.md,
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
      ...typography.body,
      color: colors.text,
      fontWeight: '800',
    },
    themeDescription: {
      ...typography.tiny,
      color: colors.muted,
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
