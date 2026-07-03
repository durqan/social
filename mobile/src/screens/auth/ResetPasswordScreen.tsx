import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KeyRound, LogIn } from 'lucide-react-native';

import { authApi } from '../../api/auth';
import { getApiErrorMessage } from '../../api/http';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, SuccessBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { spacing, typography } from '../../theme/layout';

type ResetPasswordRoute = {
  params?: {
    token?: string;
  };
};

type ResetPasswordNavigation = {
  navigate: (screen: string, params?: unknown) => void;
};

export default function ResetPasswordScreen({
  route,
  navigation,
}: {
  route: ResetPasswordRoute;
  navigation: ResetPasswordNavigation;
}) {
  const { user, logout } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const token = route.params?.token || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : 'Ссылка восстановления некорректна: token отсутствует',
  );
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError('Ссылка восстановления некорректна: token отсутствует');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      const message = await authApi.resetPassword(token, password);
      setSuccess(message || 'Пароль успешно обновлён');
      setPassword('');
      setConfirmPassword('');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoginPress() {
    if (user) {
      await logout().catch(() => undefined);
      return;
    }
    navigation.navigate('Login');
  }

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Новый пароль</Text>
        <Text style={styles.subtitle}>
          Задайте новый пароль для входа в аккаунт.
        </Text>

        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        {!success ? (
          <>
            <TextField
              label="Новый пароль"
              value={password}
              onChangeText={value => {
                setPassword(value);
                setError(token ? null : 'Ссылка восстановления некорректна: token отсутствует');
              }}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="password-new"
              placeholder="Минимум 6 символов"
            />
            <TextField
              label="Повторите пароль"
              value={confirmPassword}
              onChangeText={value => {
                setConfirmPassword(value);
                setError(token ? null : 'Ссылка восстановления некорректна: token отсутствует');
              }}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="password-new"
              placeholder="Еще раз пароль"
            />

            <AppButton
              title="Обновить пароль"
              icon={KeyRound}
              loading={loading}
              disabled={!token}
              onPress={handleSubmit}
            />
          </>
        ) : null}

        {success ? (
          <AppButton
            title="Перейти ко входу"
            variant="ghost"
            icon={LogIn}
            onPress={handleLoginPress}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    card: {
      borderWidth: 1,
      borderColor: colors.accentBorder,
      borderRadius: 28,
      backgroundColor: colors.surface,
      padding: spacing.xl,
      gap: spacing.md,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.12,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
      elevation: colors.isDark ? 0 : 3,
    },
    title: {
      ...typography.h1,
      color: colors.text,
      textAlign: 'left',
    },
    subtitle: {
      ...typography.body,
      color: colors.muted,
      textAlign: 'left',
    },
  });
