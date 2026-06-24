import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import { Camera, Mail, Save, UserRound } from 'lucide-react-native';

import { isEmailVerified } from '../../api/auth';
import { CHAT_IMAGE_MIME_TYPES } from '../../config/env';
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
import { elevation, radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

type ProfileForm = {
  name: string;
  email: string;
  bio: string;
};

export default function ProfileScreen() {
  const isFocused = useIsFocused();
  const { user, refreshUser } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [form, setForm] = useState<ProfileForm>({
    name: '',
    email: '',
    bio: '',
  });
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || '',
      email: user.email || '',
      bio: user.bio || '',
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
    if (isFocused) loadProfile().catch(() => undefined);
  });

  async function handleSave() {
    if (!user?.id) return;

    const nextEmail = form.email.trim();
    const nextName = form.name.trim();
    const nextBio = form.bio.trim();

    if (!nextName || !nextEmail) {
      setError('Заполните имя и email.');
      return;
    }
    if (!nextEmail.includes('@')) {
      setError('Введите корректный email.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await userApi.updateProfile(user.id, {
        name: nextName,
        email: nextEmail,
        age: user.age,
        bio: nextBio,
        avatar_position_x: user.avatarPositionX ?? 50,
        avatar_position_y: user.avatarPositionY ?? 50,
        avatar_scale: user.avatarScale ?? 1,
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
    if (!user?.id) return;

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      restrictMimeTypes: [...CHAT_IMAGE_MIME_TYPES],
      includeExtra: true,
    });

    if (result.didCancel) return;

    if (result.errorMessage) {
      setError('Не удалось выбрать изображение. Попробуйте еще раз.');
      return;
    }

    const image = assetToAvatarImage(result.assets?.[0]);
    if (!image) {
      setError('Выберите изображение JPEG, PNG или WebP.');
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

  const avatarUrl = buildAvatarUrl(user);
  const displayName = user.name || 'Без имени';

  return (
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={styles.heroCard}>
        <Pressable
          accessibilityRole="button"
          style={styles.avatar}
          disabled={avatarUploading}
          onPress={handlePickAvatar}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={[
                styles.avatarImage,
                avatarImageStyle({
                  size: 96,
                  positionX: user.avatarPositionX,
                  positionY: user.avatarPositionY,
                  scale: user.avatarScale,
                }),
              ]}
            />
          ) : (
            <Text style={styles.avatarText}>
              {(displayName || user.email || '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
          <View style={styles.avatarEditBadge}>
            <Camera color={colors.white} size={15} strokeWidth={2.4} />
          </View>
        </Pressable>

        <View style={styles.heroText}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
          <Text style={styles.avatarHint}>
            {avatarUploading ? 'Загружаем аватар...' : 'Нажмите на аватар, чтобы заменить фото'}
          </Text>
        </View>
      </View>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <EmailVerificationNotice />

      <View style={styles.statsCard}>
        <InfoTile
          icon={Mail}
          label="Email"
          value={isEmailVerified(user) ? 'Подтвержден' : 'Не подтвержден'}
        />
        <InfoTile
          icon={UserRound}
          label="В аккаунте"
          value={formatDateTime(user.createdAt ?? user.created_at)}
        />
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formTitle}>Редактировать профиль</Text>
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
          label="О себе"
          value={form.bio}
          onChangeText={bio => setForm(previous => ({ ...previous, bio }))}
          multiline
          style={styles.bioInput}
        />
        <AppButton
          title="Сохранить"
          icon={Save}
          loading={saving}
          onPress={handleSave}
        />
      </View>
    </Screen>
  );
}

function assetToAvatarImage(asset?: Asset) {
  if (!asset?.uri || !asset.type) return null;
  if (!(CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(asset.type)) return null;
  return {
    uri: asset.uri,
    type: asset.type,
    fileName: asset.fileName || `avatar-${Date.now()}.jpg`,
  };
}

type InfoIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: InfoIcon;
  label: string;
  value?: string;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.infoTile}>
      <View style={styles.infoIcon}>
        <Icon color={colors.accent} size={18} strokeWidth={2.4} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>{value || 'Нет данных'}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    heroCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
      shadowColor: colors.shadow,
      ...(colors.isDark ? elevation.none : elevation.card),
    },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
      borderWidth: 3,
      borderColor: colors.card,
    },
    avatarImage: {
      width: 96,
      height: 96,
    },
    avatarText: {
      color: colors.accentStrong,
      fontSize: 36,
      fontWeight: '900',
    },
    avatarEditBadge: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.card,
    },
    heroText: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    name: {
      ...typography.h2,
      color: colors.text,
    },
    email: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    avatarHint: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 16,
      color: colors.soft,
    },
    statsCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    infoTile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    infoIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.selected,
    },
    infoText: {
      flex: 1,
      minWidth: 0,
    },
    infoLabel: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.muted,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    infoValue: {
      marginTop: 2,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
      fontWeight: '600',
    },
    formCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
    },
    formTitle: {
      ...typography.h3,
      color: colors.text,
    },
    warningText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
      borderRadius: radius.lg,
      backgroundColor: colors.warningSoft,
      padding: spacing.md,
    },
    bioInput: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
  });
