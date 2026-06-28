import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ban, MessageCircle, RotateCcw, UserPlus } from 'lucide-react-native';

import { isEmailVerified } from '../../api/auth';
import { getApiErrorMessage } from '../../api/http';
import type { User } from '../../api/types';
import { userApi } from '../../api/users';
import { friendsApi } from '../../api/friends';
import { AppButton } from '../../components/AppButton';
import {
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import type { MainStackParamList } from '../../navigation/types';
import { WallFeed } from './WallFeed';

type Props = NativeStackScreenProps<MainStackParamList, 'UserProfile'>;
type FriendshipStatus =
  | 'none'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'blocked';

export default function UserProfileScreen({ navigation, route }: Props) {
  const { user: currentUser } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [profile, setProfile] = useState<User | null>(null);
  const [status, setStatus] = useState<FriendshipStatus>('none');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProfile, nextStatus] = await Promise.all([
        userApi.getUser(route.params.userId),
        friendsApi.getFriendshipStatus(route.params.userId),
      ]);
      setProfile(nextProfile);
      setStatus(nextStatus);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, [route.params.userId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  async function handleAddFriend() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await friendsApi.sendFriendRequest(route.params.userId);
      setStatus('pending');
      setSuccess('Заявка отправлена.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function handleBlockUser() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await friendsApi.blockUser(route.params.userId);
      setStatus('blocked');
      setSuccess('Пользователь заблокирован.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnblockUser() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await friendsApi.unblockUser(route.params.userId);
      setStatus('none');
      setSuccess('Пользователь разблокирован.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusy(false);
    }
  }

  function openChat() {
    if (!profile?.id) {
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'Chats',
      params: {
        screen: 'Chat',
        params: {
          userId: profile.id,
          name: profile.name || 'Пользователь',
        },
      },
    });
  }

  function openWallUser(nextUser: { id?: number; name?: string }) {
    if (!nextUser.id) {
      return;
    }
    navigation.push('UserProfile', {
      userId: nextUser.id,
      name: nextUser.name,
    });
  }

  if (loading && !profile) {
    return (
      <Screen>
        <LoadingState text="Загружаем профиль" />
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen>
        <ErrorBanner message={error || 'Профиль не найден'} />
        <AppButton title="Повторить" variant="secondary" onPress={load} />
      </Screen>
    );
  }

  const isCurrentUser = currentUser?.id === profile.id;
  const avatarUrl = buildAvatarUrl(profile);

  return (
    <Screen scroll={false} padded={false}>
      <WallFeed
        currentUser={currentUser}
        userId={profile.id}
        isOwner={isCurrentUser}
        emailVerified={isEmailVerified(currentUser)}
        onOpenUser={openWallUser}
        ListHeaderComponent={
          <>
            <View style={styles.card}>
              <View pointerEvents="none" style={styles.profileCover} />
              <View style={styles.avatar}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={[
                      styles.avatarImage,
                      avatarImageStyle({
                        size: 82,
                        positionX: profile.avatarPositionX,
                        positionY: profile.avatarPositionY,
                        scale: profile.avatarScale,
                      }),
                    ]}
                  />
                ) : (
                  <Text style={styles.avatarText}>
                    {(profile.name || '?').slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.name}>{profile.name || 'Без имени'}</Text>
              {profile.email ? (
                <Text style={styles.email}>{profile.email}</Text>
              ) : null}
            </View>

            <ErrorBanner message={error} />
            <SuccessBanner message={success} />

            <View style={styles.infoCard}>
              <InfoRow
                label="О себе"
                value={profile.bio || 'Пока не заполнено'}
              />
              {profile.age ? (
                <InfoRow label="Возраст" value={String(profile.age)} />
              ) : null}
              <InfoRow
                label="В аккаунте с"
                value={formatDateTime(profile.createdAt ?? profile.created_at)}
              />
            </View>

            {!isCurrentUser && status === 'accepted' ? (
              <AppButton
                title="Написать"
                icon={MessageCircle}
                onPress={openChat}
              />
            ) : null}
            {!isCurrentUser && status === 'none' ? (
              <AppButton
                title="Добавить в друзья"
                icon={UserPlus}
                loading={busy}
                onPress={handleAddFriend}
              />
            ) : null}
            {!isCurrentUser && status === 'pending' ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Заявка в друзья уже отправлена.
                </Text>
              </View>
            ) : null}
            {!isCurrentUser && status !== 'blocked' ? (
              <AppButton
                title="Заблокировать"
                variant="danger"
                icon={Ban}
                loading={busy}
                onPress={handleBlockUser}
              />
            ) : null}
            {!isCurrentUser && status === 'blocked' ? (
              <AppButton
                title="Разблокировать"
                variant="secondary"
                icon={RotateCcw}
                loading={busy}
                onPress={handleUnblockUser}
              />
            ) : null}
          </>
        }
      />
    </Screen>
  );
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
      borderColor: colors.accentBorder,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      padding: spacing.xl,
      gap: spacing.sm,
      overflow: 'hidden',
    },
    profileCover: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 88,
      backgroundColor: colors.profileCover,
      opacity: colors.isDark ? 0.28 : 0.5,
    },
    avatar: {
      width: 82,
      height: 82,
      borderRadius: 41,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      zIndex: 1,
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
    name: {
      ...typography.h2,
      color: colors.text,
      zIndex: 1,
    },
    email: {
      ...typography.body,
      color: colors.muted,
      zIndex: 1,
    },
    infoCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
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
    notice: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    noticeText: {
      ...typography.caption,
      color: colors.muted,
    },
  });
