import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { friendsApi } from '../../api/friends';
import { getApiErrorMessage } from '../../api/http';
import type { Friendship, User } from '../../api/types';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { colors } from '../../theme/colors';
import type { MainTabParamList } from '../../navigation/types';

type FriendsNavigation = BottomTabNavigationProp<MainTabParamList, 'Friends'>;

export default function FriendsScreen() {
  const navigation = useNavigation<FriendsNavigation>();
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextFriends, nextRequests] = await Promise.all([
        friendsApi.getFriendsList(),
        friendsApi.getFriendRequests(),
      ]);
      setFriends(nextFriends);
      setRequests(nextRequests);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  async function acceptRequest(friendshipId: number) {
    setBusyId(friendshipId);
    setError(null);
    try {
      await friendsApi.acceptFriendRequest(friendshipId);
      await load();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyId(null);
    }
  }

  async function removeFriend(friendId: number) {
    setBusyId(friendId);
    setError(null);
    try {
      await friendsApi.removeFriend(friendId);
      await load();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyId(null);
    }
  }

  function openChat(friend: User) {
    if (!friend.id) {
      return;
    }

    navigation.navigate('Chats', {
      screen: 'Chat',
      params: {
        userId: friend.id,
        name: friend.name || friend.email,
      },
    });
  }

  return (
    <Screen>
      <ErrorBanner message={error} />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Заявки</Text>
        <AppButton
          title="Обновить"
          variant="ghost"
          loading={loading}
          onPress={load}
        />
      </View>

      {requests.length === 0 ? (
        <Notice title="Новых заявок нет" />
      ) : (
        <View style={styles.listCard}>
          {requests.map(request => (
            <View key={request.id} style={styles.requestRow}>
              <View style={styles.userMeta}>
                <Text style={styles.userName}>
                  {request.user?.name || request.user?.email || 'Пользователь'}
                </Text>
                <Text style={styles.userEmail}>{request.user?.email}</Text>
              </View>
              <AppButton
                title="Принять"
                loading={busyId === request.id}
                onPress={() => acceptRequest(request.id)}
              />
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Друзья</Text>

      <FlatList
        data={friends}
        keyExtractor={item => String(item.id ?? item.email)}
        scrollEnabled={false}
        ListEmptyComponent={<Notice title="Список друзей пуст" />}
        renderItem={({ item }) => (
          <Pressable style={styles.friendRow} onPress={() => openChat(item)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.name || item.email).slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.userMeta}>
              <Text style={styles.userName}>{item.name || item.email}</Text>
              <Text style={styles.userEmail}>{item.email}</Text>
            </View>
            {item.id ? (
              <AppButton
                title="Удалить"
                variant="secondary"
                loading={busyId === item.id}
                onPress={() => removeFriend(item.id as number)}
              />
            ) : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  requestRow: {
    padding: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  avatarText: {
    color: colors.accentStrong,
    fontSize: 18,
    fontWeight: '800',
  },
  userMeta: {
    flex: 1,
    gap: 3,
  },
  userName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  userEmail: {
    color: colors.muted,
    fontSize: 13,
  },
});
