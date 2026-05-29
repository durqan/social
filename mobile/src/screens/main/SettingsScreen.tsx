import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { API_BASE_URL, WS_URL } from '../../config/env';
import { AppButton } from '../../components/AppButton';
import { Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

export default function SettingsScreen() {
  const { logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.title}>Сессия</Text>
        <Text style={styles.text}>
          Мобильный клиент использует cookies backend и CSRF header. Access
          token не сохраняется в AsyncStorage или localStorage-аналоге.
        </Text>
        <AppButton
          title="Выйти"
          variant="danger"
          loading={loggingOut}
          onPress={handleLogout}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Backend</Text>
        <Text style={styles.label}>API</Text>
        <Text style={styles.mono}>{API_BASE_URL}</Text>
        <Text style={styles.label}>WebSocket</Text>
        <Text style={styles.mono}>{WS_URL}</Text>
      </View>

      <Notice
        title="TODO: звонки"
        text="Аудио/видео звонки не перенесены в первый этап. Для React Native нужен react-native-webrtc, permissions camera/microphone и проверка совместимости текущего signaling."
      />

      <Notice
        title="TODO: темы"
        text="Dark/light режим можно добавить позже через общий theme provider. Сейчас UI повторяет светлую палитру web frontend."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  mono: {
    color: colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
  },
});
