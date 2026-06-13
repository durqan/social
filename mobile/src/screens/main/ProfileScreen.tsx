import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
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
import { radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

type ProfileForm = {
  name: string;
  email: string;
  age: string;
  bio: string;
  avatarPositionX: string;
  avatarPositionY: string;
  avatarScale: string;
};

export default function ProfileScreen() {
  const isFocused = useIsFocused();
  const { user, refreshUser } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [form, setForm] = useState<ProfileForm>({
    name: '',
    email: '',
    age: '',
    bio: '',
    avatarPositionX: '50',
    avatarPositionY: '50',
    avatarScale: '1',
  });
  const [refreshing, setRefreshing] = useState(false);
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
      avatarPositionX: String(user.avatarPositionX ?? 50),
      avatarPositionY: String(user.avatarPositionY ?? 50),
      avatarScale: String(user.avatarScale ?? 1),
    });
  }, [user]);

  const emailWillChange = useMemo(
    () => Boolean(user?.email && form.email.trim() !== user.email),
    [form.email, user?.email],
  );

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      await refreshUser();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }, [refreshUser]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setSuccess(null);
    try {
      await loadProfile();
    } finally {
      setRefreshing(false);
    }
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      loadProfile().catch(() => undefined);
    }, [loadProfile]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    loadProfile().catch(() => undefined);
  });

  async function handleSave() {
    if (!user?.id) {
      return;
    }

    const nextEmail = form.email.trim();
    const nextName = form.name.trim();
    const nextBio = form.bio.trim();
    const nextAge = form.age.trim() ? Number(form.age.trim()) : undefined;
    const nextAvatarPositionX = Number(form.avatarPositionX.trim() || 50);
    const nextAvatarPositionY = Number(form.avatarPositionY.trim() || 50);
    const nextAvatarScale = Number(form.avatarScale.trim() || 1);

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

    if (
      !Number.isFinite(nextAvatarPositionX) ||
      nextAvatarPositionX < 0 ||
      nextAvatarPositionX > 100 ||
      !Number.isFinite(nextAvatarPositionY) ||
      nextAvatarPositionY < 0 ||
      nextAvatarPositionY > 100
    ) {
      setError('Позиция аватара должна быть от 0 до 100.');
      return;
    }

    if (
      !Number.isFinite(nextAvatarScale) ||
      nextAvatarScale < 1 ||
      nextAvatarScale > 3
    ) {
      setError('Масштаб аватара должен быть от 1 до 3.');
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
        avatar_position_x: nextAvatarPositionX,
        avatar_position_y: nextAvatarPositionY,
        avatar_scale: nextAvatarScale,
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
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
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
              style={[
                styles.avatarImage,
                avatarImageStyle({
                  size: 82,
                  positionX: user.avatarPositionX,
                  positionY: user.avatarPositionY,
                  scale: user.avatarScale,
                }),
              ]}
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
        <Text style={styles.avatarSettingsTitle}>Позиция аватара</Text>
        <View style={styles.avatarSettingsGrid}>
          <TextField
            label="X (0-100)"
            value={form.avatarPositionX}
            onChangeText={avatarPositionX =>
              setForm(previous => ({ ...previous, avatarPositionX }))
            }
            keyboardType="decimal-pad"
          />
          <TextField
            label="Y (0-100)"
            value={form.avatarPositionY}
            onChangeText={avatarPositionY =>
              setForm(previous => ({ ...previous, avatarPositionY }))
            }
            keyboardType="decimal-pad"
          />
          <TextField
            label="Масштаб (1-3)"
            value={form.avatarScale}
            onChangeText={avatarScale =>
              setForm(previous => ({ ...previous, avatarScale }))
            }
            keyboardType="decimal-pad"
          />
        </View>
        <AppButton title="Сохранить" loading={saving} onPress={handleSave} />
      </View>
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
      borderRadius: radius.md,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    avatar: {
      width: 82,
      height: 82,
      borderRadius: 41,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
    },
    avatarImage: {
      width: 82,
      height: 82,
    },
    avatarText: {
      color: colors.accentStrong,
      fontSize: 30,
      fontWeight: '800',
    },
    avatarHint: {
      ...typography.caption,
      color: colors.soft,
      textAlign: 'center',
    },
    name: {
      ...typography.h2,
      color: colors.text,
    },
    email: {
      ...typography.body,
      color: colors.muted,
    },
    infoCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    infoRow: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      padding: spacing.md,
      gap: spacing.xs,
    },
    infoLabel: {
      ...typography.tiny,
      color: colors.muted,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    infoValue: {
      ...typography.body,
      color: colors.text,
    },
    formCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
    },
    formTitle: {
      ...typography.h3,
      color: colors.text,
    },
    warningText: {
      ...typography.caption,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.warningSoft,
      borderRadius: radius.md,
      backgroundColor: colors.warningSoft,
      padding: spacing.md,
    },
    avatarSettingsTitle: {
      ...typography.body,
      color: colors.text,
      fontWeight: '800',
    },
    avatarSettingsGrid: {
      gap: spacing.sm,
    },
    bioInput: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
  });
