import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

export default function SettingsScreen() {
  const { logout, user } = useAuth();
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
});
