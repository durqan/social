import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, MessageCircle, UserPlus } from 'lucide-react-native';

import { AppButton } from '../../components/AppButton';
import { ErrorBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login, authError, clearAuthError } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit() {
    clearAuthError();
    setLocalError(null);

    if (!email.trim() || !password) {
      setLocalError('Введите email и пароль');
      return;
    }

    setLoading(true);
    try {
      await login({
        email: email.trim(),
        password,
      });
    } catch {
      // AuthContext exposes the normalized API message.
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.brandMark}>
          <MessageCircle color={colors.white} size={24} strokeWidth={2.5} />
        </View>
        <Text style={styles.title}>Вход</Text>
        <Text style={styles.subtitle}>
          Используйте тот же аккаунт, что и в веб-версии.
        </Text>

        <ErrorBanner message={localError ?? authError} />

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <TextField
          label="Пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          placeholder="Ваш пароль"
        />

        <AppButton
          title="Войти"
          icon={LogIn}
          loading={loading}
          onPress={handleSubmit}
        />
        <AppButton
          title="Создать аккаунт"
          variant="ghost"
          icon={UserPlus}
          onPress={() => navigation.navigate('Register')}
        />
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
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      padding: spacing.xl,
      gap: spacing.md,
    },
    brandMark: {
      width: 54,
      height: 54,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      marginBottom: spacing.xs,
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
