import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Check,
  KeyRound,
  LogOut,
  Palette,
  ShieldCheck,
  Type,
} from 'lucide-react-native';
import LinearGradient from 'react-native-linear-gradient';

import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, SuccessBanner } from '../../components/Feedback';
import { Card } from '../../components/Layout';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useTheme, useThemeColors } from '../../theme/ThemeContext';
import {
  themeOrder,
  themes,
  type ThemeColors,
  type ThemeId,
} from '../../theme/themes';
import {
  radius,
  spacing,
  textSizeOptions,
  textSizeOrder,
  typography,
  type TextSizeId,
} from '../../theme/layout';
import { lightHaptic } from '../../utils/haptics';

type SecurityBusyAction = 'password';

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
      await userApi.changePassword(user.id, {
        current_password: currentPassword,
        new_password: newPassword,
      });
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

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <Card style={styles.card}>
        <SectionHeader
          icon={ShieldCheck}
          title="Безопасность"
          subtitle="Пароль, сессии и защита аккаунта"
        />
        <ErrorBanner message={securityError} />
        <SuccessBanner message={securitySuccess} />
        <View style={styles.passwordBox}>
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
            disabled={Boolean(securityBusy)}
            onPress={handleChangePassword}
            style={styles.primaryButton}
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionHeader
          icon={Type}
          title="Размер текста"
          subtitle="Ваш режим плотности поверх системного размера шрифта"
        />
        <View style={styles.textSizeGrid}>
          {textSizeOrder.map(nextTextSizeId => (
            <TextSizeOption
              key={nextTextSizeId}
              textSizeId={nextTextSizeId}
              selected={textSizeId === nextTextSizeId}
              onPress={() => setTextSizeId(nextTextSizeId)}
            />
          ))}
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionHeader
          icon={Palette}
          title="Тема оформления"
          subtitle="Компоненты используют одни токены, меняется только палитра"
        />
        <View style={styles.themeGrid}>
          {themeOrder.map(nextThemeId => (
            <ThemeOption
              key={nextThemeId}
              themeId={nextThemeId}
              selected={themeId === nextThemeId}
              onPress={() => setThemeId(nextThemeId)}
            />
          ))}
        </View>
      </Card>
        <AppButton
            title={loggingOut ? 'Выходим...' : 'Выйти из аккаунта'}
            variant="danger"
            icon={LogOut}
            loading={loggingOut}
            onPress={handleLogout}
            style={styles.logoutButton}
        />
    </Screen>
  );
}

type SettingsIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: SettingsIcon;
  title: string;
  subtitle: string;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.cardHeader}>
      <View style={styles.headerIcon}>
        <Icon color={colors.accentStrong} size={20} strokeWidth={2.5} />
      </View>
      <View style={styles.headerTextBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{subtitle}</Text>
      </View>
    </View>
  );
}

function TextSizeOption({
  textSizeId,
  selected,
  onPress,
}: {
  textSizeId: TextSizeId;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const option = textSizeOptions[textSizeId];
  const sampleSize = textSizeId === 'compact' ? 16 : textSizeId === 'large' ? 21 : 18;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.textSizeOption,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
      onPress={() => {
        lightHaptic();
        onPress();
      }}
    >
      <Text style={[styles.textSizeSample, { fontSize: sampleSize, lineHeight: sampleSize + 4 }]}>Aa</Text>
      <Text style={styles.textSizeName}>{option.label}</Text>
      <Text style={styles.textSizeDescription} numberOfLines={2}>{option.description}</Text>
    </Pressable>
  );
}

function ThemeOption({
  themeId,
  selected,
  onPress,
}: {
  themeId: ThemeId;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const theme = themes[themeId];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.themeOption,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
      onPress={() => {
        lightHaptic();
        onPress();
      }}
    >
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
      <View style={[styles.themeCheck, selected && styles.themeCheckSelected]}>
        {selected ? <Check color={colors.white} size={12} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screenContent: { gap: spacing.lg },
    accountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.lg,
      gap: spacing.md,
      overflow: 'hidden',
    },
    accountAccent: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 5,
      backgroundColor: colors.accent,
    },
    accountAvatar: {
      width: 54,
      height: 54,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      borderWidth: 2,
      borderColor: colors.borderStrong,
    },
    accountAvatarText: {
      color: colors.accentStrong,
      fontSize: 23,
      fontWeight: '900',
    },
    accountInfo: { flex: 1, minWidth: 0 },
    accountTitle: { ...typography.subtitle, color: colors.textPrimary },
    accountText: { marginTop: 3, ...typography.caption, color: colors.muted },
    logoutButton: { borderRadius: radius.lg },
    card: { gap: spacing.md, borderRadius: radius.xl },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headerIcon: {
      width: 42,
      height: 42,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    headerTextBlock: { flex: 1, minWidth: 0 },
    title: { ...typography.subtitle, color: colors.textPrimary },
    text: { marginTop: 2, ...typography.caption, color: colors.muted },
    passwordBox: {
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      padding: spacing.md,
      backgroundColor: colors.surfaceMuted,
    },
    primaryButton: { borderRadius: radius.lg },
    textSizeGrid: { flexDirection: 'row', gap: spacing.sm },
    textSizeOption: {
      flex: 1,
      minHeight: 104,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.cardMuted,
      padding: spacing.sm,
    },
    textSizeSample: { color: colors.textPrimary, fontWeight: '900' },
    textSizeName: {
      color: colors.textPrimary,
      ...typography.caption,
      fontWeight: '900',
      textAlign: 'center',
    },
    textSizeDescription: {
      color: colors.muted,
      ...typography.tiny,
      textAlign: 'center',
    },
    themeGrid: { gap: spacing.sm },
    themeOption: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.cardMuted,
      padding: spacing.md,
    },
    optionSelected: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.selected,
    },
    optionPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
    themeSwatch: {
      width: 42,
      height: 42,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    themeSwatchAccent: { height: 12 },
    themeMeta: { flex: 1, minWidth: 0 },
    themeName: { color: colors.textPrimary, ...typography.body, fontWeight: '900' },
    themeDescription: { marginTop: 2, color: colors.muted, ...typography.caption },
    themeCheck: {
      width: 22,
      height: 22,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    themeCheckSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
  });
