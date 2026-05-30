import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

export default function EmailVerificationNoticeScreen() {
  const { logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Подтвердите email</Text>
        <Text style={styles.subtitle}>
          Это займет минуту и откроет все возможности аккаунта.
        </Text>
      </View>

      <EmailVerificationNotice showRefresh />
      <AppButton
        title="Выйти"
        variant="ghost"
        loading={loggingOut}
        onPress={handleLogout}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 16,
  },
  header: {
    gap: 8,
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
});
