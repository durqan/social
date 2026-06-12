import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi } from '../../api/auth';
import { getApiErrorMessage } from '../../api/http';
import { AppButton } from '../../components/AppButton';
import {
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { spacing, typography } from '../../theme/layout';

type VerifyEmailRoute = {
  params?: {
    token?: string;
  };
};

type VerifyEmailNavigation = {
  navigate: (screen: string, params?: unknown) => void;
};

export default function VerifyEmailScreen({
  route,
  navigation,
}: {
  route: VerifyEmailRoute;
  navigation: VerifyEmailNavigation;
}) {
  const { user, refreshUser } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const token = route.params?.token || '';
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function verify() {
      if (!token) {
        setError('Некорректная ссылка подтверждения email.');
        setLoading(false);
        return;
      }

      try {
        const message = await authApi.verifyEmail(token);
        if (!mounted) {
          return;
        }
        setSuccess(message || 'Email подтвержден.');
        await refreshUser().catch(() => undefined);
      } catch (apiError) {
        if (mounted) {
          setError(getApiErrorMessage(apiError));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    verify().catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [refreshUser, token]);

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Подтверждение email</Text>
        <Text style={styles.subtitle}>
          Проверяем ссылку и обновляем статус аккаунта.
        </Text>
      </View>

      {loading ? <LoadingState text="Подтверждаем email" /> : null}
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      {!loading ? (
        <AppButton
          title={user ? 'Вернуться в приложение' : 'Перейти ко входу'}
          onPress={() => {
            navigation.navigate(user ? 'MainTabs' : 'Login');
          }}
        />
      ) : null}
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      justifyContent: 'center',
      gap: spacing.md,
    },
    header: {
      gap: spacing.sm,
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
