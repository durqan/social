import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, Search, Trash2, UserRound, X } from 'lucide-react-native';

import { friendsApi } from '../../api/friends';
import { getApiErrorMessage } from '../../api/http';
import type { Friendship, User } from '../../api/types';
import { assetURL } from '../../config/env';
import { AppButton } from '../../components/AppButton';
import { IconButton } from '../../components/IconButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useNotifications } from '../../context/NotificationsContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle } from '../../utils/avatar';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';
import type {
  MainStackParamList,
  MainTabParamList,
} from '../../navigation/types';

type FriendsNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Friends'>,
  NativeStackNavigationProp<MainStackParamList>
>;
type LoadMode = 'initial' | 'refresh' | 'silent';

export default function FriendsScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<FriendsNavigation>();
  const { markMatchingAsRead } = useNotifications();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: LoadMode = 'initial') => {
    const showInitialLoading = mode === 'initial' && !hasLoadedRef.current;

    if (showInitialLoading) {
      setLoading(true);
    }
    if (mode === 'refresh') {
      setRefreshing(true);
    }
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
      hasLoadedRef.current = true;
      setHasLoaded(true);
      if (showInitialLoading) {
        setLoading(false);
      }
      if (mode === 'refresh') {
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(hasLoadedRef.current ? 'silent' : 'initial').catch(() => undefined);
      markMatchingAsRead({
        types: ['friend_accepted'],
      }).catch(() => undefined);
    }, [load, markMatchingAsRead]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    load('silent').catch(() => undefined);
  });

  async function acceptRequest(request: Friendship) {
    setBusyId(request.id);
    setError(null);
    try {
      await friendsApi.acceptFriendRequest(request.id);
      await markMatchingAsRead({
        types: ['friend_request'],
        actor_id: request.user_id,
      }).catch(() => undefined);
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

  async function rejectRequest(request: Friendship) {
    setBusyId(request.id);
    setError(null);
    try {
      await friendsApi.rejectFriendRequest(request.user_id);
      await markMatchingAsRead({
        types: ['friend_request'],
        actor_id: request.user_id,
      }).catch(() => undefined);
      await load();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyId(null);
    }
  }

  function openProfile(target: User) {
    if (!target.id) {
      return;
    }

    navigation.navigate('UserProfile', {
      userId: target.id,
      name: target.name || 'Пользователь',
    });
  }

  function openChat(friend: User) {
    if (!friend.id) {
      return;
    }

    navigation.navigate('Chats', {
      screen: 'Chat',
      params: {
        userId: friend.id,
        name: friend.name || 'Пользователь',
      },
    });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => load('refresh')}>
      <ErrorBanner message={error} />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Друзья</Text>
        <View style={styles.headerActions}>
          <AppButton
            title="Поиск"
            variant="secondary"
            icon={Search}
            onPress={() => navigation.navigate('UserSearch')}
          />
        </View>
      </View>

      {loading && !hasLoaded ? (
        <LoadingState text="Загружаем друзей" />
      ) : (
        <>
          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Заявки в друзья</Text>
            {requests.length === 0 ? (
              <EmptyState
                title="Заявок пока нет"
                text="Когда кто-то отправит вам заявку, она появится здесь."
              />
            ) : (
              <View style={styles.listCard}>
                {requests.map(request => (
                  <View key={request.id} style={styles.requestRow}>
                    <Pressable
                      style={styles.requestUser}
                      onPress={() => request.user && openProfile(request.user)}
                    >
                      <UserAvatar user={request.user} colors={colors} />
                      <View style={styles.userMeta}>
                        <Text style={styles.userName}>
                          {request.user?.name || 'Пользователь'}
                        </Text>
                        {request.user?.email ? (
                          <Text style={styles.userEmail}>
                            {request.user.email}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <View style={styles.requestActions}>
                      <AppButton
                        title="Профиль"
                        variant="secondary"
                        icon={UserRound}
                        style={styles.actionButton}
                        onPress={() =>
                          request.user && openProfile(request.user)
                        }
                      />
                      <AppButton
                        title="Принять"
                        icon={Check}
                        style={styles.actionButton}
                        loading={busyId === request.id}
                        onPress={() => acceptRequest(request)}
                      />
                      <AppButton
                        title="Отклонить"
                        variant="ghost"
                        icon={X}
                        style={styles.actionButton}
                        loading={busyId === request.id}
                        onPress={() => rejectRequest(request)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Мои друзья</Text>
            <FlatList
              data={friends}
              keyExtractor={item => String(item.id)}
              scrollEnabled={false}
              ListEmptyComponent={
                <EmptyState
                  title="У вас пока нет друзей"
                  text="Добавьте друзей через поиск или примите входящую заявку."
                />
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.friendRow}
                  onPress={() => openChat(item)}
                >
                  <UserAvatar user={item} colors={colors} />
                  <View style={styles.userMeta}>
                    <Text style={styles.userName}>
                      {item.name || 'Пользователь'}
                    </Text>
                    {item.email ? (
                      <Text style={styles.userEmail}>{item.email}</Text>
                    ) : null}
                  </View>
                  {item.id ? (
                    <IconButton
                      label="Открыть профиль"
                      variant="ghost"
                      icon={UserRound}
                      size="sm"
                      style={styles.friendAction}
                      onPress={() => openProfile(item)}
                    />
                  ) : null}
                  {item.id ? (
                    <IconButton
                      label="Удалить из друзей"
                      variant="danger"
                      icon={Trash2}
                      size="sm"
                      style={styles.friendAction}
                      loading={busyId === item.id}
                      onPress={() => removeFriend(item.id as number)}
                    />
                  ) : null}
                </Pressable>
              )}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function UserAvatar({ user, colors }: { user?: User; colors: ThemeColors }) {
  const styles = createStyles(colors);

  return (
    <View style={styles.avatar}>
      {user?.avatar ? (
        <Image
          source={{ uri: assetURL(user.avatar) }}
          style={[
            styles.avatarImage,
            avatarImageStyle({
              size: 44,
              positionX: user.avatarPositionX,
              positionY: user.avatarPositionY,
              scale: user.avatarScale,
            }),
          ]}
          resizeMode="cover"
        />
      ) : (
        <Text style={styles.avatarText}>
          {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    headerActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    sectionTitle: {
      ...typography.h2,
      color: colors.text,
    },
    subsection: {
      gap: spacing.sm,
    },
    subsectionTitle: {
      ...typography.h3,
      color: colors.text,
    },
    listCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    requestRow: {
      padding: spacing.md,
      gap: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    requestUser: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    requestActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    actionButton: {
      flex: 1,
    },
    friendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    avatarImage: {
      width: 44,
      height: 44,
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
      ...typography.body,
      color: colors.text,
      fontWeight: '700',
    },
    userEmail: {
      ...typography.caption,
      color: colors.muted,
    },
    friendAction: {
      width: 38,
      height: 38,
    },
  });
