import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import {
  Camera,
  Mail,
  Minus,
  Move,
  Plus,
  Save,
  UserRound,
} from 'lucide-react-native';

import { isEmailVerified } from '../../api/auth';
import {
  AVATAR_IMAGE_MAX_BYTES,
  AVATAR_IMAGE_MIME_TYPES,
} from '../../config/env';
import { getApiErrorMessage } from '../../api/http';
import { userApi } from '../../api/users';
import { AppButton } from '../../components/AppButton';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import {
  ErrorBanner,
  SuccessBanner,
} from '../../components/Feedback';
import { ProfileSkeleton } from '../../components/Skeleton';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

type ProfileForm = {
  name: string;
  email: string;
  bio: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10) / 10;

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
  const [avatarX, setAvatarX] = useState(50);
  const [avatarY, setAvatarY] = useState(50);
  const [avatarScale, setAvatarScale] = useState(1);
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
    setAvatarX(user.avatarPositionX ?? 50);
    setAvatarY(user.avatarPositionY ?? 50);
    setAvatarScale(user.avatarScale ?? 1);
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
        avatar_position_x: avatarX,
        avatar_position_y: avatarY,
        avatar_scale: avatarScale,
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
      restrictMimeTypes: [...AVATAR_IMAGE_MIME_TYPES],
      includeExtra: true,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.9,
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
    if (image.fileSize && image.fileSize > AVATAR_IMAGE_MAX_BYTES) {
      setError('Аватар должен быть не больше 10 МБ.');
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
        <ProfileSkeleton />
      </Screen>
    );
  }

  const avatarUrl = buildAvatarUrl(user);
  const displayName = form.name || user.name || 'Без имени';
  const initial = (displayName || user.email || '?').slice(0, 1).toUpperCase();

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={styles.screenContent}
    >
      <View style={styles.profileTopCard}>
        <View pointerEvents="none" style={styles.profileCover} />
        <Pressable
          accessibilityRole="button"
          style={styles.mainAvatar}
          disabled={avatarUploading}
          onPress={handlePickAvatar}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={[
                styles.mainAvatarImage,
                avatarImageStyle({
                  size: 88,
                  positionX: avatarX,
                  positionY: avatarY,
                  scale: avatarScale,
                }),
              ]}
            />
          ) : (
            <Text style={styles.mainAvatarText}>{initial}</Text>
          )}
          <View style={styles.cameraBadge}>
            <Camera color={colors.white} size={15} strokeWidth={2.5} />
          </View>
        </Pressable>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={styles.onlineRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Онлайн</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.changePhotoButton}
          disabled={avatarUploading}
          onPress={handlePickAvatar}
        >
          <Camera color={colors.accent} size={16} strokeWidth={2.5} />
          <Text style={styles.changePhotoText}>
            {avatarUploading ? 'Загрузка...' : 'Изменить фото'}
          </Text>
        </Pressable>
      </View>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <EmailVerificationNotice />

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.sectionTitle}>О себе</Text>
          <Text style={styles.counter}>{form.bio.length}/160</Text>
        </View>
        <TextField
          label="О себе"
          value={form.bio}
          onChangeText={bio => setForm(previous => ({ ...previous, bio }))}
          multiline
          maxLength={160}
          placeholder="Расскажите пару слов о себе"
          style={styles.bioInput}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.titleWithIcon}>
            <View style={styles.softIcon}>
              <Move color={colors.accent} size={18} strokeWidth={2.5} />
            </View>
            <Text style={styles.sectionTitle}>Аватар</Text>
          </View>
          <Text style={styles.helperText}>двигайте и масштабируйте</Text>
        </View>

        <View style={styles.avatarEditorRow}>
          <View style={styles.cropArea}>
            <View style={styles.gridLineVertical} />
            <View style={styles.gridLineHorizontal} />
            <View style={styles.cropAvatar}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={[
                    styles.cropAvatarImage,
                    avatarImageStyle({
                      size: 112,
                      positionX: avatarX,
                      positionY: avatarY,
                      scale: avatarScale,
                    }),
                  ]}
                />
              ) : (
                <Text style={styles.cropAvatarText}>{initial}</Text>
              )}
            </View>
          </View>
          <View style={styles.positionControls}>
            <NudgeButton
              label="Вверх"
              onPress={() => setAvatarY(value => clamp(value - 5, 0, 100))}
            >
              ↑
            </NudgeButton>
            <View style={styles.sideControlsRow}>
              <NudgeButton
                label="Влево"
                onPress={() => setAvatarX(value => clamp(value - 5, 0, 100))}
              >
                ←
              </NudgeButton>
              <NudgeButton
                label="Вправо"
                onPress={() => setAvatarX(value => clamp(value + 5, 0, 100))}
              >
                →
              </NudgeButton>
            </View>
            <NudgeButton
              label="Вниз"
              onPress={() => setAvatarY(value => clamp(value + 5, 0, 100))}
            >
              ↓
            </NudgeButton>
          </View>
        </View>

        <View style={styles.scaleRow}>
          <Pressable
            accessibilityRole="button"
            style={styles.scaleButton}
            onPress={() =>
              setAvatarScale(value => round(clamp(value - 0.1, 1, 3)))
            }
          >
            <Minus color={colors.text} size={17} strokeWidth={2.5} />
          </Pressable>
          <View style={styles.scaleTrack}>
            <View
              style={[
                styles.scaleFill,
                { width: `${((avatarScale - 1) / 2) * 100}%` },
              ]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.scaleButton}
            onPress={() =>
              setAvatarScale(value => round(clamp(value + 0.1, 1, 3)))
            }
          >
            <Plus color={colors.text} size={17} strokeWidth={2.5} />
          </Pressable>
          <Text style={styles.scaleValue}>{avatarScale.toFixed(1)}x</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Профиль</Text>
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
      </View>

      <View style={styles.infoGrid}>
        <InfoTile
          icon={Mail}
          label="Email"
          value={isEmailVerified(user) ? 'Подтвержден' : 'Не подтвержден'}
        />
        <InfoTile
          icon={UserRound}
          label="С нами"
          value={formatDateTime(user.createdAt ?? user.created_at)}
        />
      </View>

      <AppButton
        title="Сохранить изменения"
        icon={Save}
        loading={saving}
        onPress={handleSave}
        style={styles.saveButton}
      />
    </Screen>
  );
}

function assetToAvatarImage(asset?: Asset) {
  if (!asset?.uri || !asset.type) return null;
  if (!(AVATAR_IMAGE_MIME_TYPES as readonly string[]).includes(asset.type))
    return null;
  return {
    uri: asset.uri,
    type: asset.type,
    fileName: asset.fileName || `avatar-${Date.now()}.jpg`,
    fileSize: asset.fileSize,
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
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value || 'Нет данных'}
      </Text>
    </View>
  );
}

function NudgeButton({
  children,
  label,
  onPress,
}: {
  children: string;
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.nudgeButton}
      onPress={onPress}
    >
      <Text style={styles.nudgeText}>{children}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screenContent: { gap: 16 },
    profileTopCard: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 30,
      backgroundColor: colors.card,
      padding: spacing.xl,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.38 : 0.12,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 16 },
      elevation: colors.isDark ? 6 : 3,
    },
    profileCover: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 122,
      backgroundColor: colors.profileCover,
      opacity: colors.isDark ? 0.72 : 0.52,
    },
    mainAvatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
      borderWidth: 4,
      borderColor: colors.borderStrong,
      shadowColor: colors.accent,
      shadowOpacity: colors.isDark ? 0.34 : 0.14,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 6,
      zIndex: 1,
    },
    mainAvatarImage: { width: 88, height: 88 },
    mainAvatarText: { color: colors.accent, fontSize: 34, fontWeight: '900' },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderWidth: 3,
      borderColor: colors.card,
    },
    name: {
      marginTop: 12,
      ...typography.h3,
      color: colors.text,
      textAlign: 'center',
      zIndex: 1,
    },
    onlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      zIndex: 1,
    },
    onlineDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    onlineText: { ...typography.tiny, color: colors.muted, fontWeight: '700' },
    changePhotoButton: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: colors.accentSoft,
      zIndex: 1,
    },
    changePhotoText: { color: colors.accent, fontSize: 13, fontWeight: '900' },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.card,
      padding: spacing.lg,
      gap: spacing.md,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.22 : 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: colors.isDark ? 3 : 1,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    titleWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    softIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    sectionTitle: { ...typography.h3, color: colors.text },
    counter: { ...typography.tiny, color: colors.soft, fontWeight: '800' },
    helperText: {
      ...typography.tiny,
      color: colors.muted,
      flexShrink: 1,
      textAlign: 'right',
    },
    bioInput: { minHeight: 82, textAlignVertical: 'top' },
    avatarEditorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    cropArea: {
      flex: 1,
      minHeight: 150,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.18 : 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 7 },
      elevation: colors.isDark ? 0 : 1,
    },
    gridLineVertical: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '50%',
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
    },
    gridLineHorizontal: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '50%',
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
    },
    cropAvatar: {
      width: 112,
      height: 112,
      borderRadius: 56,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
      borderWidth: 4,
      borderColor: colors.borderStrong,
    },
    cropAvatarImage: { width: 112, height: 112 },
    cropAvatarText: { color: colors.accent, fontSize: 40, fontWeight: '900' },
    positionControls: { width: 94, alignItems: 'center', gap: 8 },
    sideControlsRow: { flexDirection: 'row', gap: 8 },
    nudgeButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardMuted,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.18 : 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    nudgeText: { color: colors.text, fontSize: 17, fontWeight: '900' },
    scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    scaleButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    scaleTrack: {
      flex: 1,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    scaleFill: { height: '100%', backgroundColor: colors.accent },
    scaleValue: {
      width: 44,
      color: colors.text,
      fontSize: 13,
      fontWeight: '900',
      textAlign: 'right',
    },
    warningText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
      borderRadius: radius.lg,
      backgroundColor: colors.warningSoft,
      padding: spacing.md,
    },
    infoGrid: { flexDirection: 'row', gap: spacing.md },
    infoTile: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: 7,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.2 : 0.05,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 9 },
      elevation: colors.isDark ? 3 : 1,
    },
    infoIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    infoLabel: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.muted,
      fontWeight: '800',
    },
    infoValue: {
      fontSize: 14,
      lineHeight: 18,
      color: colors.text,
      fontWeight: '800',
    },
    saveButton: { marginTop: -2, borderRadius: 18 },
  });
