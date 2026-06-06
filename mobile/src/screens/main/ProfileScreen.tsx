import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';

import { isEmailVerified } from '../../api/auth';
import { assetURL, CHAT_IMAGE_MIME_TYPES } from '../../config/env';
import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import {
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { formatDateTime } from '../../utils/format';

type ProfileForm = {
  name: string;
  email: string;
  age: string;
  bio: string;
};

export default function ProfileScreen() {
  const { user, refreshUser } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [form, setForm] = useState<ProfileForm>({
    name: '',
    email: '',
    age: '',
    bio: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    setForm({
      name: user.name || '',
      email: user.email || '',
      age: user.age ? String(user.age) : '',
      bio: user.bio || '',
    });
  }, [user]);

  const emailWillChange = useMemo(
    () => Boolean(user?.email && form.email.trim() !== user.email),
    [form.email, user?.email],
  );

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await refreshUser();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user?.id) {
      return;
    }

    const nextEmail = form.email.trim();
    const nextName = form.name.trim();
    const nextBio = form.bio.trim();
    const nextAge = form.age.trim() ? Number(form.age.trim()) : undefined;

    if (!nextName || !nextEmail) {
      setError('Заполните имя и email');
      return;
    }

    if (!nextEmail.includes('@')) {
      setError('Введите корректный email');
      return;
    }

    if (nextAge !== undefined && (!Number.isFinite(nextAge) || nextAge < 0)) {
      setError('Возраст должен быть положительным числом');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await userApi.updateProfile(user.id, {
        name: nextName,
        email: nextEmail,
        age: nextAge,
        bio: nextBio,
      });
      await refreshUser();
      setSuccess(
        emailWillChange
          ? 'Профиль сохранен. Новый email нужно будет подтвердить.'
          : 'Профиль сохранен.',
      );
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setSaving(false);
    }
  }

  async function handlePickAvatar() {
    if (!user?.id) {
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      restrictMimeTypes: [...CHAT_IMAGE_MIME_TYPES],
      includeExtra: true,
    });

    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError('Не удалось выбрать изображение. Попробуйте еще раз.');
      return;
    }

    const asset = result.assets?.[0];
    const image = assetToAvatarImage(asset);
    if (!image) {
      setError('Выберите изображение JPEG, PNG или WebP');
      return;
    }

    setAvatarUploading(true);
    setError(null);
    setSuccess(null);
    try {
      await userApi.uploadAvatar(user.id, image);
      await refreshUser();
      setSuccess('Аватар обновлен.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setAvatarUploading(false);
    }
  }

  if (!user) {
    return (
      <Screen>
        <LoadingState text="Загружаем профиль" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          style={styles.avatar}
          disabled={avatarUploading}
          onPress={handlePickAvatar}
        >
          {user.avatar ? (
            <Image
              source={{ uri: assetURL(user.avatar) }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>
              {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </Pressable>
        <Text style={styles.name}>{user.name || 'Без имени'}</Text>
        <Text style={styles.email}>{user.email}</Text>
        <Text style={styles.avatarHint}>
          {avatarUploading
            ? 'Загружаем аватар'
            : 'Нажмите на аватар, чтобы обновить'}
        </Text>
      </View>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <EmailVerificationNotice />

      <View style={styles.infoCard}>
        <InfoRow label="О себе" value={user.bio || 'Пока не заполнено'} />
        {user.age ? <InfoRow label="Возраст" value={String(user.age)} /> : null}
        <InfoRow
          label="В аккаунте с"
          value={formatDateTime(user.createdAt ?? user.created_at)}
        />
        <InfoRow
          label="Email"
          value={isEmailVerified(user) ? 'Подтвержден' : 'Не подтвержден'}
        />
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formTitle}>Редактирование</Text>
        <TextField
          label="Имя"
          value={form.name}
          onChangeText={name => setForm(previous => ({ ...previous, name }))}
          autoCapitalize="words"
          textContentType="name"
        />
        <TextField
          label="Email"
          value={form.email}
          onChangeText={email => setForm(previous => ({ ...previous, email }))}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />
        {emailWillChange ? (
          <Text style={styles.warningText}>
            После смены email нужно будет подтвердить новый адрес.
          </Text>
        ) : null}
        <TextField
          label="Возраст"
          value={form.age}
          onChangeText={age => setForm(previous => ({ ...previous, age }))}
          keyboardType="number-pad"
        />
        <TextField
          label="О себе"
          value={form.bio}
          onChangeText={bio => setForm(previous => ({ ...previous, bio }))}
          multiline
          style={styles.bioInput}
        />
        <AppButton title="Сохранить" loading={saving} onPress={handleSave} />
      </View>

      <AppButton
        title="Обновить профиль"
        variant="secondary"
        loading={loading}
        onPress={handleRefresh}
      />
    </Screen>
  );
}

function assetToAvatarImage(asset?: Asset) {
  if (!asset?.uri || !asset.type) {
    return null;
  }

  if (!(CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(asset.type)) {
    return null;
  }

  return {
    uri: asset.uri,
    type: asset.type,
    fileName: asset.fileName || `avatar-${Date.now()}.jpg`,
  };
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Нет данных'}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 8,
  },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.accent,
  },
  avatarImage: {
    width: 82,
    height: 82,
  },
  avatarText: {
    color: colors.white,
    fontSize: 30,
    fontWeight: '800',
  },
  avatarHint: {
    color: colors.soft,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  name: {
    color: colors.text,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
  },
  email: {
    color: colors.muted,
    fontSize: 15,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  infoRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    padding: 14,
    gap: 4,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  formCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 14,
  },
  formTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  warningText: {
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
    padding: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  bioInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
