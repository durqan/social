import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { spacing, typography } from '../../theme/layout';

export default function EmailVerificationNoticeScreen() {
  const { logout } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
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
