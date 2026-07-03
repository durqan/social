import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, Mail } from 'lucide-react-native';

import { authApi } from '../../api/auth';
import { getApiErrorMessage } from '../../api/http';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, SuccessBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { spacing, typography } from '../../theme/layout';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

const neutralSuccessMessage =
  'Если email существует, мы отправили ссылку для восстановления пароля';

export default function ForgotPasswordScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit() {
    const nextEmail = email.trim();
    setError(null);
    setSuccess(null);

    if (!nextEmail || !nextEmail.includes('@')) {
      setError('Введите корректный email');
      return;
    }

    setLoading(true);
    try {
      const message = await authApi.forgotPassword(nextEmail);
      setSuccess(message || neutralSuccessMessage);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Восстановление пароля</Text>
        <Text style={styles.subtitle}>
          Укажите email аккаунта, и мы отправим ссылку для смены пароля.
        </Text>

        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <TextField
          label="Email"
          value={email}
          onChangeText={value => {
            setEmail(value);
            setError(null);
            setSuccess(null);
          }}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          placeholder="you@example.com"
        />

        <AppButton
          title="Отправить ссылку"
          icon={Mail}
          loading={loading}
          onPress={handleSubmit}
        />
        <AppButton
          title="Вернуться ко входу"
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
