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
import { spacing, typography } from '../../theme/layout';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { register, authError, clearAuthError } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit() {
    clearAuthError();
    setLocalError(null);

    if (!name.trim() || !email.trim() || !password) {
      setLocalError('Заполните имя, email и пароль');
      return;
    }

    if (!email.includes('@')) {
      setLocalError('Введите корректный email');
      return;
    }

    if (password.length < 6) {
      setLocalError('Пароль должен содержать минимум 6 символов');
      return;
    }

    if (password !== confirmPassword) {
      setLocalError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        website: '',
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
        <Text style={styles.title}>Регистрация</Text>
        <Text style={styles.subtitle}>
          После регистрации backend попросит подтвердить email.
        </Text>

        <ErrorBanner message={localError ?? authError} />

        <TextField
          label="Имя"
          value={name}
          onChangeText={setName}
          textContentType="name"
          autoComplete="name"
          autoCapitalize="words"
          placeholder="Ваше имя"
        />
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
          textContentType="newPassword"
          autoComplete="password-new"
          placeholder="Минимум 6 символов"
        />
        <TextField
          label="Повторите пароль"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="password-new"
          placeholder="Еще раз пароль"
        />

        <AppButton
          title="Зарегистрироваться"
          icon={UserPlus}
          loading={loading}
          onPress={handleSubmit}
        />
        <AppButton
          title="Уже есть аккаунт"
          variant="ghost"
          icon={LogIn}
          onPress={() => navigation.navigate('Login')}
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
    brandMark: {
      width: 58,
      height: 58,
      borderRadius: 29,
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
