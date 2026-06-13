import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import { e2eeApi } from '../../api/e2ee';
import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, Notice, SuccessBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import {
  clearLocalE2EEKeyBundle,
  enableE2EEForUser,
  reencryptBackupWithPassword,
  restoreE2EEFromBackup,
} from '../../crypto/keyBackup';
import { getLocalE2EEKeyBundle } from '../../crypto/masterKey';
import { isWebCryptoAvailable } from '../../crypto/webCrypto';
import { useTheme, useThemeColors } from '../../theme/ThemeContext';
import { themeOrder, themes, type ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

type SecurityBusyAction =
  | 'password'
  | 'enableE2EE'
  | 'restoreE2EE'
  | 'disableE2EE'
  | 'refreshE2EE';

export default function SettingsScreen() {
  const isFocused = useIsFocused();
  const { logout, user } = useAuth();
  const { themeId, setThemeId } = useTheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const webCryptoAvailable = isWebCryptoAvailable();
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [e2eePassword, setE2eePassword] = useState('');
  const [e2eeEnabled, setE2eeEnabled] = useState(false);
  const [localKeyReady, setLocalKeyReady] = useState(false);
  const [securityBusy, setSecurityBusy] = useState<SecurityBusyAction | null>(
    null,
  );
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);

  const loadE2EEStatus = useCallback(async () => {
    if (!user?.id) {
      setE2eeEnabled(false);
      setLocalKeyReady(false);
      return;
    }

    setSecurityBusy(previous => previous ?? 'refreshE2EE');
    try {
      const [status, localKey] = await Promise.all([
        e2eeApi.getStatus(),
        getLocalE2EEKeyBundle(user.id),
      ]);
      setE2eeEnabled(status.enabled);
      setLocalKeyReady(Boolean(localKey));
    } catch (apiError) {
      setSecurityError(getApiErrorMessage(apiError));
    } finally {
      setSecurityBusy(previous =>
        previous === 'refreshE2EE' ? null : previous,
      );
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadE2EEStatus().catch(() => undefined);
    }, [loadE2EEStatus]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    loadE2EEStatus().catch(() => undefined);
  });

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
      let encryptedMasterKey: string | undefined;
      if (e2eeEnabled) {
        if (!localKeyReady) {
          throw new Error('E2EE local key is not restored');
        }
        encryptedMasterKey =
          (await reencryptBackupWithPassword(user.id, newPassword)) ||
          undefined;
        if (!encryptedMasterKey) {
          throw new Error('E2EE local key is not restored');
        }
      }

      await userApi.changePassword(user.id, {
        current_password: currentPassword,
        new_password: newPassword,
        encrypted_master_key: encryptedMasterKey,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecuritySuccess(
        e2eeEnabled
          ? 'Пароль изменен, E2EE backup перешифрован.'
          : 'Пароль изменен.',
      );
      await loadE2EEStatus();
    } catch (apiError) {
      setSecurityError(securityErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  async function handleEnableE2EE() {
    if (!user?.id) {
      return;
    }
    if (!webCryptoAvailable) {
      setSecurityError('WebCrypto недоступен в текущем runtime React Native.');
      return;
    }
    if (!e2eePassword) {
      setSecurityError('Введите пароль аккаунта для E2EE backup.');
      return;
    }

    setSecurityBusy('enableE2EE');
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      const encryptedMasterKey = await enableE2EEForUser(user.id, e2eePassword);
      await e2eeApi.enable(encryptedMasterKey);
      setE2eePassword('');
      setE2eeEnabled(true);
      setLocalKeyReady(true);
      setSecuritySuccess('E2EE включено, backup сохранен на сервере.');
    } catch (apiError) {
      setSecurityError(securityErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  async function handleRestoreE2EE() {
    if (!user?.id) {
      return;
    }
    if (!webCryptoAvailable) {
      setSecurityError('WebCrypto недоступен в текущем runtime React Native.');
      return;
    }
    if (!e2eePassword) {
      setSecurityError('Введите пароль аккаунта для восстановления E2EE.');
      return;
    }

    setSecurityBusy('restoreE2EE');
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      const backup = await e2eeApi.getBackup();
      if (!backup.enabled || !backup.encrypted_master_key) {
        setSecurityError('E2EE backup не найден.');
        return;
      }
      await restoreE2EEFromBackup(
        user.id,
        e2eePassword,
        backup.encrypted_master_key,
      );
      setE2eePassword('');
      setE2eeEnabled(true);
      setLocalKeyReady(true);
      setSecuritySuccess('E2EE ключ восстановлен на устройстве.');
    } catch (apiError) {
      setSecurityError(securityErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  async function handleDisableE2EE() {
    if (!user?.id) {
      return;
    }

    setSecurityBusy('disableE2EE');
    setSecurityError(null);
    setSecuritySuccess(null);
    try {
      await e2eeApi.disable();
      await clearLocalE2EEKeyBundle(user.id);
      setE2eePassword('');
      setE2eeEnabled(false);
      setLocalKeyReady(false);
      setSecuritySuccess('E2EE отключено.');
    } catch (apiError) {
      setSecurityError(securityErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  const securityBusyNow = Boolean(securityBusy);

  return (
    <Screen
      refreshing={securityBusy === 'refreshE2EE'}
      onRefresh={() => {
        loadE2EEStatus().catch(() => undefined);
      }}
    >
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
          Управление паролем и локальным E2EE ключом этого устройства.
        </Text>
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
          {e2eeEnabled ? (
            <Text style={styles.hint}>
              При смене пароля E2EE backup будет перешифрован новым паролем.
            </Text>
          ) : null}
          <AppButton
            title="Сменить пароль"
            loading={securityBusy === 'password'}
            disabled={securityBusyNow}
            onPress={handleChangePassword}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.statusRow}>
            <Text style={styles.sectionTitle}>E2EE</Text>
            <Text
              style={[
                styles.statusPill,
                e2eeEnabled ? styles.statusPillOn : styles.statusPillOff,
              ]}
            >
              {e2eeEnabled ? 'Включено' : 'Выключено'}
            </Text>
          </View>
          <Text style={styles.text}>
            Локальный ключ: {localKeyReady ? 'восстановлен' : 'не восстановлен'}
          </Text>
          {!webCryptoAvailable ? (
            <Notice
              title="WebCrypto недоступен"
              text="E2EE требует crypto.subtle и crypto.getRandomValues в React Native runtime."
            />
          ) : null}
          <TextField
            label="Пароль аккаунта для E2EE"
            value={e2eePassword}
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            onChangeText={setE2eePassword}
          />
          <View style={styles.actions}>
            <AppButton
              title="Включить E2EE"
              loading={securityBusy === 'enableE2EE'}
              disabled={securityBusyNow || e2eeEnabled || !webCryptoAvailable}
              onPress={handleEnableE2EE}
            />
            <AppButton
              title="Восстановить ключ"
              variant="secondary"
              loading={securityBusy === 'restoreE2EE'}
              disabled={securityBusyNow || !e2eeEnabled || !webCryptoAvailable}
              onPress={handleRestoreE2EE}
            />
            <AppButton
              title="Отключить E2EE"
              variant="danger"
              loading={securityBusy === 'disableE2EE'}
              disabled={securityBusyNow || !e2eeEnabled}
              onPress={handleDisableE2EE}
            />
          </View>
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
  if (error instanceof Error) {
    if (
      error.message === 'E2EE local key is not restored' ||
      error.message === 'WebCrypto is unavailable in this React Native runtime'
    ) {
      return 'E2EE ключ недоступен на устройстве. Восстановите ключ перед этим действием.';
    }
    if (error.message.includes('Invalid encrypted E2EE backup')) {
      return 'E2EE backup поврежден или имеет неподдерживаемый формат.';
    }
  }

  return getApiErrorMessage(error);
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
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
    hint: {
      ...typography.caption,
      color: colors.muted,
    },
    actions: {
      gap: spacing.sm,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    statusPill: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      ...typography.tiny,
      fontWeight: '800',
      overflow: 'hidden',
    },
    statusPillOn: {
      backgroundColor: colors.successSoft,
      color: colors.success,
    },
    statusPillOff: {
      backgroundColor: colors.cardMuted,
      color: colors.muted,
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
      borderRadius: radius.md,
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
