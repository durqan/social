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
import { Check, Search, Trash2, UserRound, UsersRound, X } from 'lucide-react-native';

import { friendsApi } from '../../api/friends';
import { getApiErrorMessage } from '../../api/http';
import type { Friendship, User } from '@social/shared';
import { AppButton } from '../../components/AppButton';
import { IconButton } from '../../components/IconButton';
import {
  EmptyState,
  ErrorBanner,
} from '../../components/Feedback';
import { FriendsListSkeleton } from '../../components/Skeleton';
import { MiniProfileSheet } from '../../components/MiniProfileSheet';
import { Screen } from '../../components/Screen';
import { useNotifications } from '../../context/NotificationsContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
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
  const [profileUser, setProfileUser] = useState<User | null>(null);
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

      <View style={styles.topActions}>
        <AppButton
          title="Найти"
          variant="secondary"
          icon={Search}
          style={styles.searchButton}
          onPress={() => navigation.navigate('UserSearch')}
        />
      </View>

      {loading && !hasLoaded ? (
        <FriendsListSkeleton />
      ) : (
        <>
          {requests.length > 0 ? (
            <View style={styles.subsection}>
              <Text style={styles.subsectionTitle}>Заявки в друзья</Text>
              <View style={styles.listCard}>
                {requests.map(request => (
                  <View key={request.id} style={styles.requestRow}>
                    <Pressable
                      style={styles.requestUser}
                      onPress={() => request.user && openProfile(request.user)}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Открыть мини-профиль"
                        onPress={event => {
                          event.stopPropagation();
                          if (request.user) {
                            setProfileUser(request.user);
                          }
                        }}
                      >
                        <UserAvatar user={request.user} colors={colors} />
                      </Pressable>
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
            </View>
          ) : null}

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Мои друзья</Text>
            <FlatList
              data={friends}
              keyExtractor={item => String(item.id)}
              scrollEnabled={false}
              ListEmptyComponent={
                <EmptyState
                  icon={UsersRound}
                  title="Пока нет друзей"
                  text="Добавьте друзей через поиск или примите входящую заявку."
                />
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.friendRow}
                  onPress={() => openChat(item)}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Открыть мини-профиль"
                    onPress={event => {
                      event.stopPropagation();
                      setProfileUser(item);
                    }}
                  >
                    <UserAvatar user={item} colors={colors} />
                  </Pressable>
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
      <MiniProfileSheet
        visible={Boolean(profileUser)}
        userId={profileUser?.id}
        user={profileUser}
        onClose={() => setProfileUser(null)}
        onOpenProfile={(userId, name) =>
          navigation.navigate('UserProfile', { userId, name })
        }
        onMessage={(userId, name) =>
          navigation.navigate('Chats', {
            screen: 'Chat',
            params: { userId, name: name || 'Пользователь' },
          })
        }
      />
    </Screen>
  );
}

function UserAvatar({ user, colors }: { user?: User; colors: ThemeColors }) {
  const styles = createStyles(colors);
  const avatarUrl = buildAvatarUrl(user);

  return (
    <View style={styles.avatar}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={[
            styles.avatarImage,
            avatarImageStyle({
              size: 44,
              positionX: user?.avatarPositionX,
              positionY: user?.avatarPositionY,
              scale: user?.avatarScale,
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
    topActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: spacing.md,
    },
    searchButton: {
      alignSelf: 'flex-end',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 74,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      padding: spacing.lg,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.28 : 0.12,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 12 },
      elevation: colors.isDark ? 4 : 1,
    },
    headerActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    sectionTitle: {
      ...typography.h2,
      color: colors.textPrimary,
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
      borderRadius: 24,
      backgroundColor: colors.card,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.2 : 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: colors.isDark ? 3 : 1,
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
      borderRadius: 22,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.md,
      marginBottom: spacing.sm,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.2 : 0,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 9 },
      elevation: colors.isDark ? 2 : 0,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.borderStrong,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.24 : 0.08,
      shadowRadius: 9,
      shadowOffset: { width: 0, height: 4 },
      elevation: colors.isDark ? 0 : 1,
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
      color: colors.textPrimary,
      fontWeight: '700',
    },
    userEmail: {
      ...typography.caption,
      color: colors.muted,
    },
    friendAction: {},
  });
