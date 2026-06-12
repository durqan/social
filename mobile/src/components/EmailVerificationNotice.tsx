import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isEmailVerified } from '../api/auth';
import { getApiErrorMessage } from '../api/http';
import { useAuth } from '../context/AuthContext';
import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { AppButton } from './AppButton';
import { ErrorBanner, SuccessBanner } from './Feedback';

type EmailVerificationNoticeProps = {
  showRefresh?: boolean;
};

export function EmailVerificationNotice({
  showRefresh = false,
}: EmailVerificationNoticeProps) {
  const { user, refreshUser, sendVerificationEmail } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [loading, setLoading] = useState<'send' | 'refresh' | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isEmailVerified(user)) {
    return showRefresh ? (
      <SuccessBanner message="Email подтвержден. Аккаунт готов к работе." />
    ) : null;
  }

  async function handleSend() {
    setLoading('send');
    setSuccess(null);
    setError(null);

    try {
      await sendVerificationEmail();
      setSuccess('Письмо отправлено. Проверьте входящие и папку Спам.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(null);
    }
  }

  async function handleRefresh() {
    setLoading('refresh');
    setSuccess(null);
    setError(null);

    try {
      await refreshUser();
      setSuccess('Статус email обновлен.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.textBlock}>
        <Text style={styles.title}>
          Подтвердите email, чтобы пользоваться всеми возможностями
        </Text>
        <Text style={styles.text}>
          Мы отправим письмо на {user?.email ?? 'ваш адрес'}. После
          подтверждения обновите статус в приложении.
        </Text>
      </View>

      <SuccessBanner message={success} />
      <ErrorBanner message={error} />

      <View style={styles.actions}>
        <AppButton
          title="Отправить письмо повторно"
          loading={loading === 'send'}
          onPress={handleSend}
        />
        {showRefresh ? (
          <AppButton
            title="Проверить статус"
            variant="secondary"
            loading={loading === 'refresh'}
            onPress={handleRefresh}
          />
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
    padding: 16,
    gap: 12,
  },
  textBlock: {
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  text: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    gap: 10,
  },
});
