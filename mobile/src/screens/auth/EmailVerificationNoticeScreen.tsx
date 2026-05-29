import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { ErrorBanner, Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { getApiErrorMessage } from '../../api/http';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

export default function EmailVerificationNoticeScreen() {
  const { user, logout, refreshUser, sendVerificationEmail } = useAuth();
  const [loading, setLoading] = useState<'send' | 'refresh' | 'logout' | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setLoading('send');
    setError(null);
    setMessage(null);
    try {
      const responseMessage = await sendVerificationEmail();
      setMessage(responseMessage || 'Письмо отправлено');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(null);
    }
  }

  async function handleRefresh() {
    setLoading('refresh');
    setError(null);
    try {
      await refreshUser();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(null);
    }
  }

  async function handleLogout() {
    setLoading('logout');
    await logout();
  }

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Подтвердите email</Text>
        <Text style={styles.subtitle}>
          Для сообщений, загрузки изображений и действий с друзьями backend
          требует подтвержденный адрес.
        </Text>

        <Notice
          title={user?.email ?? 'Email не найден'}
          text="Откройте письмо с подтверждением, затем вернитесь сюда и обновите статус."
        />

        {message ? (
          <View style={styles.success}>
            <Text style={styles.successText}>{message}</Text>
          </View>
        ) : null}
        <ErrorBanner message={error} />

        <AppButton
          title="Отправить письмо"
          loading={loading === 'send'}
          onPress={handleSend}
        />
        <AppButton
          title="Проверить статус"
          variant="secondary"
          loading={loading === 'refresh'}
          onPress={handleRefresh}
        />
        <AppButton
          title="Выйти"
          variant="ghost"
          loading={loading === 'logout'}
          onPress={handleLogout}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 16,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  success: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    backgroundColor: colors.successSoft,
    padding: 12,
  },
  successText: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 20,
  },
});
