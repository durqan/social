import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { apiAssetURL } from '../api/client';
import { authApi, userApi } from '../api/services';
import { Button, Card, Field, Screen } from '../components/ui';
import type { User } from '../types';
import { alertError } from '../utils/errors';

export function ProfileScreen({ user, onUserChange, onLogout }: { user: User; onUserChange: (user: User) => void; onLogout: () => void }) {
  const [name, setName] = useState(user.name || '');
  const [bio, setBio] = useState(user.bio || '');
  const [saving, setSaving] = useState(false);
  const avatarURL = apiAssetURL(user.avatar);

  const save = async () => {
    if (!user.id) return;
    try {
      setSaving(true);
      const updated = await userApi.update(user.id, { name: name.trim(), bio: bio.trim() });
      onUserChange(updated);
      Alert.alert('Готово', 'Профиль обновлён');
    } catch (error) {
      alertError(error, 'Не удалось обновить профиль');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await authApi.logout();
    onLogout();
  };

  const pickAvatar = async () => {
    if (!user.id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к фото, чтобы выбрать аватар');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    try {
      const uploaded = await userApi.uploadAvatar(user.id, result.assets[0].uri);
      onUserChange({ ...user, avatar: uploaded.avatar });
    } catch (error) {
      alertError(error, 'Не удалось загрузить аватар');
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Card>
          {avatarURL && <Image source={{ uri: avatarURL }} style={styles.avatar} />}
          <Text style={styles.title}>{user.name || 'Профиль'}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <Text style={styles.status}>{user.isEmailVerified ? 'Email подтверждён' : 'Email не подтверждён'}</Text>
          <View style={styles.avatarAction}>
            <Button title="Сменить аватар" variant="secondary" onPress={pickAvatar} />
          </View>
        </Card>

        <Card>
          <Text style={styles.section}>Редактирование</Text>
          <View style={styles.form}>
            <Field value={name} onChangeText={setName} placeholder="Имя" />
            <Field value={bio} onChangeText={setBio} placeholder="О себе" multiline />
            <Button title={saving ? 'Сохранение...' : 'Сохранить'} onPress={save} disabled={saving} />
          </View>
        </Card>

        <Button title="Выйти" variant="danger" onPress={logout} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    gap: 12,
  },
  title: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '900',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 12,
    backgroundColor: '#e5e7eb',
  },
  avatarAction: {
    marginTop: 12,
  },
  email: {
    color: '#4b5563',
    fontSize: 15,
    marginTop: 4,
  },
  status: {
    color: '#0284c7',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  section: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  form: {
    gap: 10,
  },
});
