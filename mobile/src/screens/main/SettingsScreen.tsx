import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, KeyRound, Lock, LogOut, MonitorSmartphone, Palette, ShieldCheck, Type } from 'lucide-react-native';
import LinearGradient from 'react-native-linear-gradient';

import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, SuccessBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import {
  getMobilePushPermissionStatus,
  openMobilePushNotificationSettings,
  requestMobilePushPermissionPrompt,
  type MobilePushPermissionStatus,
} from '../../notifications/pushNotifications';
import { useTheme, useThemeColors } from '../../theme/ThemeContext';
import { themeOrder, themes, type ThemeColors, type ThemeId } from '../../theme/themes';
import { spacing, textSizeOptions, textSizeOrder, typography, type TextSizeId } from '../../theme/layout';

type SecurityBusyAction = 'password';

type SettingsIcon = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

export default function SettingsScreen() {
  const { logout, user } = useAuth();
  const { themeId, setThemeId, textSizeId, setTextSizeId } = useTheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityBusy, setSecurityBusy] = useState<SecurityBusyAction | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  const [pushPermissionStatus, setPushPermissionStatus] = useState<MobilePushPermissionStatus>('unsupported');
  const [pushPermissionBusy, setPushPermissionBusy] = useState(false);

  async function refreshPushPermissionStatus() {
    const status = await getMobilePushPermissionStatus();
    setPushPermissionStatus(status);
  }

  useEffect(() => {
    refreshPushPermissionStatus().catch(() => undefined);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  async function handleChangePassword() {
    if (!user?.id) return;
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
      await userApi.changePassword(user.id, { current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecuritySuccess('Пароль изменен.');
    } catch (apiError) {
      setSecurityError(getApiErrorMessage(apiError));
    } finally {
      setSecurityBusy(null);
    }
  }

  async function handlePushPermissionAction() {
    setPushPermissionBusy(true);
    try {
      if (pushPermissionStatus === 'prompt_available') {
        await requestMobilePushPermissionPrompt();
      } else {
        await openMobilePushNotificationSettings();
      }
      await refreshPushPermissionStatus();
    } finally {
      setPushPermissionBusy(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <View style={styles.accountCard}>
        <View pointerEvents="none" style={styles.accountAccent} />
        <View style={styles.accountAvatar}>
          <Text style={styles.accountAvatarText}>{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.accountInfo}>
          <Text style={styles.accountTitle}>Аккаунт</Text>
          <Text style={styles.accountText} numberOfLines={2}>{user?.name || user?.email || 'Вы'} сейчас активен на этом устройстве.</Text>
        </View>
      </View>

      <Pressable accessibilityRole="button" style={styles.logoutFullButton} disabled={loggingOut} onPress={handleLogout}>
        <LogOut color={colors.danger} size={20} strokeWidth={2.5} />
        <Text style={styles.logoutFullText}>{loggingOut ? 'Выходим...' : 'Выйти из аккаунта'}</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerIcon}><ShieldCheck color={colors.accent} size={20} strokeWidth={2.5} /></View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>Безопасность</Text>
            <Text style={styles.text}>Пароль, сессии и защита аккаунта</Text>
          </View>
        </View>

        <SettingsRow icon={Lock} title="Смена пароля" subtitle="Обновите пароль для защиты аккаунта" />

        <ErrorBanner message={securityError} />
        <SuccessBanner message={securitySuccess} />

        <View style={styles.passwordBox}>
          <TextField label="Текущий пароль" value={currentPassword} secureTextEntry textContentType="password" autoComplete="password" onChangeText={setCurrentPassword} />
          <TextField label="Новый пароль" value={newPassword} secureTextEntry textContentType="newPassword" autoComplete="password-new" onChangeText={setNewPassword} />
          <TextField label="Повторите новый пароль" value={confirmPassword} secureTextEntry textContentType="newPassword" autoComplete="password-new" onChangeText={setConfirmPassword} />
          <AppButton title="Сменить пароль" icon={KeyRound} loading={securityBusy === 'password'} disabled={Boolean(securityBusy)} onPress={handleChangePassword} style={styles.primaryButton} />
        </View>

        <SettingsRow icon={MonitorSmartphone} title="Активные сессии" subtitle="Текущее устройство активно" rightText="1" />
      </View>

      {pushPermissionStatus !== 'unsupported' ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.headerIcon}><Bell color={colors.accent} size={20} strokeWidth={2.5} /></View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.title}>Уведомления</Text>
              <Text style={styles.text}>{pushPermissionStatus === 'granted' ? 'Push-уведомления включены' : 'Push-уведомления отключены'}</Text>
            </View>
          </View>
          {pushPermissionStatus !== 'granted' ? (
            <AppButton title={pushPermissionStatus === 'prompt_available' ? 'Разрешить уведомления' : 'Открыть настройки'} icon={Bell} loading={pushPermissionBusy} onPress={handlePushPermissionAction} style={styles.primaryButton} />
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerIcon}><Type color={colors.accent} size={20} strokeWidth={2.5} /></View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>Размер текста</Text>
            <Text style={styles.text}>Настройте плотность интерфейса</Text>
          </View>
        </View>
        <View style={styles.textSizeGrid}>
          {textSizeOrder.map(nextTextSizeId => (
            <TextSizeOption key={nextTextSizeId} textSizeId={nextTextSizeId} selected={textSizeId === nextTextSizeId} onPress={() => setTextSizeId(nextTextSizeId)} />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerIcon}><Palette color={colors.accent} size={20} strokeWidth={2.5} /></View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>Тема оформления</Text>
            <Text style={styles.text}>По умолчанию — светлый чистый интерфейс</Text>
          </View>
        </View>
        <View style={styles.themeGrid}>
          {themeOrder.map(nextThemeId => (
            <ThemeOption key={nextThemeId} themeId={nextThemeId} selected={themeId === nextThemeId} onPress={() => setThemeId(nextThemeId)} />
          ))}
        </View>
      </View>
    </Screen>
  );
}

function TextSizeOption({ textSizeId, selected, onPress }: { textSizeId: TextSizeId; selected: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const option = textSizeOptions[textSizeId];
  const sampleSize = textSizeId === 'compact' ? 16 : textSizeId === 'large' ? 21 : 18;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.textSizeOption, selected && styles.textSizeOptionSelected, pressed && styles.themeOptionPressed]} onPress={onPress}>
      <Text style={[styles.textSizeSample, { fontSize: sampleSize, lineHeight: sampleSize + 4 }]}>Aa</Text>
      <Text style={styles.textSizeName}>{option.label}</Text>
      <Text style={styles.textSizeDescription} numberOfLines={2}>{option.description}</Text>
    </Pressable>
  );
}

function SettingsRow({ icon: Icon, title, subtitle, rightText }: { icon: SettingsIcon; title: string; subtitle: string; rightText?: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.rowItem}>
      <View style={styles.rowIcon}><Icon color={colors.accent} size={18} strokeWidth={2.4} /></View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {rightText ? <Text style={styles.rowRightText}>{rightText}</Text> : <ChevronRight color={colors.soft} size={20} strokeWidth={2.4} />}
    </View>
  );
}

function ThemeOption({ themeId, selected, onPress }: { themeId: ThemeId; selected: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const theme = themes[themeId];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.themeOption, selected && styles.themeOptionSelected, pressed && styles.themeOptionPressed]} onPress={onPress}>
      <View style={[styles.themeSwatch, { backgroundColor: theme.background }]}>
        <LinearGradient
          colors={theme.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.themeSwatchAccent}
        />
      </View>
      <View style={styles.themeMeta}>
        <Text style={styles.themeName} numberOfLines={1}>{theme.name}</Text>
        <Text style={styles.themeDescription} numberOfLines={1}>{theme.isDark ? 'Темная тема' : 'Светлая тема'}</Text>
      </View>
      <View style={[styles.themeCheck, selected && styles.themeCheckSelected]} />
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screenContent: { gap: 16 },
    accountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 30,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.32 : 0.1,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 14 },
      elevation: colors.isDark ? 5 : 2,
    },
    accountAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: colors.accent },
    accountAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.borderStrong },
    accountAvatarText: { color: colors.accent, fontSize: 23, fontWeight: '900' },
    accountInfo: { flex: 1, minWidth: 0 },
    accountTitle: { ...typography.h3, color: colors.text },
    accountText: { marginTop: 3, ...typography.caption, color: colors.muted },
    logoutFullButton: { minHeight: 58, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerSoft },
    logoutFullText: { color: colors.danger, fontSize: 16, fontWeight: '900' },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 28, backgroundColor: colors.card, padding: spacing.lg, gap: spacing.md, shadowColor: colors.shadow, shadowOpacity: colors.isDark ? 0.24 : 0.08, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: colors.isDark ? 4 : 1 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    headerTextBlock: { flex: 1, minWidth: 0 },
    title: { ...typography.h3, color: colors.text },
    text: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.muted },
    rowItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 58, borderRadius: 20, padding: spacing.md, backgroundColor: colors.cardMuted, borderWidth: 1, borderColor: colors.border },
    rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
    rowSubtitle: { marginTop: 2, color: colors.muted, fontSize: 12, lineHeight: 16 },
    rowRightText: { color: colors.accent, fontSize: 14, fontWeight: '900' },
    passwordBox: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: spacing.md, backgroundColor: colors.surfaceMuted },
    primaryButton: { borderRadius: 18 },
    textSizeGrid: { flexDirection: 'row', gap: spacing.sm },
    textSizeOption: { flex: 1, minHeight: 104, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.cardMuted, padding: spacing.sm },
    textSizeOptionSelected: { borderColor: colors.accentBorder, backgroundColor: colors.selected },
    textSizeSample: { color: colors.text, fontWeight: '900' },
    textSizeName: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '900', textAlign: 'center' },
    textSizeDescription: { color: colors.muted, fontSize: 10, lineHeight: 13, textAlign: 'center' },
    themeGrid: { gap: spacing.sm },
    themeOption: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.cardMuted, padding: spacing.md },
    themeOptionSelected: { borderColor: colors.accentBorder, backgroundColor: colors.selected },
    themeOptionPressed: { opacity: 0.78 },
    themeSwatch: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', justifyContent: 'flex-end' },
    themeSwatchAccent: { height: 12 },
    themeMeta: { flex: 1, minWidth: 0 },
    themeName: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
    themeDescription: { marginTop: 2, color: colors.muted, fontSize: 12, lineHeight: 16 },
    themeCheck: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
    themeCheckSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  });
