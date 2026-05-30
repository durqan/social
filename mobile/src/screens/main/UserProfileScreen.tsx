import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { assetURL } from '../../config/env';
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
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';
import type { MainStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'UserProfile'>;
type FriendshipStatus =
  | 'none'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'blocked';

export default function UserProfileScreen({ navigation, route }: Props) {
  const { user: currentUser } = useAuth();
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
          name: profile.name || profile.email,
        },
      },
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

  return (
    <Screen>
      <View style={styles.card}>
        <View style={styles.avatar}>
          {profile.avatar ? (
            <Image
              source={{ uri: assetURL(profile.avatar) }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>
              {(profile.name || profile.email || '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <Text style={styles.name}>{profile.name || 'Без имени'}</Text>
        <Text style={styles.email}>{profile.email}</Text>
      </View>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <View style={styles.infoCard}>
        <InfoRow label="О себе" value={profile.bio || 'Пока не заполнено'} />
        {profile.age ? (
          <InfoRow label="Возраст" value={String(profile.age)} />
        ) : null}
        <InfoRow
          label="В аккаунте с"
          value={formatDateTime(profile.createdAt ?? profile.created_at)}
        />
      </View>

      {!isCurrentUser && status === 'accepted' ? (
        <AppButton title="Написать" onPress={openChat} />
      ) : null}
      {!isCurrentUser && status === 'none' ? (
        <AppButton
          title="Добавить в друзья"
          loading={busy}
          onPress={handleAddFriend}
        />
      ) : null}
      {!isCurrentUser && status === 'pending' ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Заявка в друзья уже отправлена.</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Нет данных'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
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
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
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
  notice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
  },
  noticeText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
