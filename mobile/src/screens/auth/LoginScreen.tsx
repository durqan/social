import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AppButton } from '../../components/AppButton';
import { ErrorBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login, authError, clearAuthError } = useAuth();
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

        <AppButton title="Войти" loading={loading} onPress={handleSubmit} />
        <AppButton
          title="Создать аккаунт"
          variant="ghost"
          onPress={() => navigation.navigate('Register')}
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
    fontSize: 26,
    lineHeight: 32,
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
