import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { authApi } from '../api/services';
import { Button, Field } from '../components/ui';
import type { User } from '../types';
import { alertError } from '../utils/errors';

export function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim() || (mode === 'register' && !name.trim())) {
      Alert.alert('Ошибка', 'Заполни все поля');
      return;
    }

    try {
      setLoading(true);
      const response =
        mode === 'login'
          ? await authApi.login(email.trim(), password)
          : await authApi.register(name.trim(), email.trim(), password);
      onAuth(response.user);
    } catch (error) {
      alertError(error, 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Social</Text>
        <Text style={styles.subtitle}>Мобильная версия</Text>
      </View>

      <View style={styles.form}>
        {mode === 'register' && <Field value={name} onChangeText={setName} placeholder="Имя" />}
        <Field value={email} onChangeText={setEmail} placeholder="Email" />
        <Field value={password} onChangeText={setPassword} placeholder="Пароль" secureTextEntry />
        <Button title={loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'} onPress={submit} disabled={loading} />

        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.switcher}>
          <Text style={styles.switcherText}>
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f5f7',
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    color: '#111827',
    fontSize: 42,
    fontWeight: '900',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 17,
    marginTop: 4,
  },
  form: {
    gap: 12,
  },
  switcher: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  switcherText: {
    color: '#0284c7',
    fontSize: 15,
    fontWeight: '700',
  },
});
