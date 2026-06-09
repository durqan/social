import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { SocialNotification, User } from '../../api/types';
import { userApi } from '../../api/users';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationsContext';
import type {
  MainStackParamList,
  MainTabParamList,
} from '../../navigation/types';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { formatDateTime } from '../../utils/format';

type NotificationsNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Notifications'>,
  NativeStackNavigationProp<MainStackParamList>
>;

const notificationText: Record<string, (actorName: string) => string> = {
  post_liked: actorName => `${actorName} лайкнул(а) ваш пост`,
  comment_created: actorName => `${actorName} прокомментировал(а) ваш пост`,
  friend_request: actorName => `${actorName} отправил(а) заявку в друзья`,
  friend_accepted: actorName => `${actorName} принял(а) вашу заявку`,
  message_received: actorName => `${actorName} написал(а) вам`,
};

function notificationTitle(notification: SocialNotification, actor?: User) {
  const actorName = actor?.name || actor?.email || 'Пользователь';
  return notificationText[notification.type]?.(actorName) || 'Новое уведомление';
}

function notificationAction(notification: SocialNotification) {
  switch (notification.type) {
    case 'message_received':
      return 'Открыть чат';
    case 'friend_request':
      return 'Открыть заявки';
    case 'friend_accepted':
      return 'Открыть профиль';
    case 'post_liked':
    case 'comment_created':
      return 'Открыть главную';
    default:
      return 'Открыть';
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NotificationsNavigation>();
  const { user } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const {
    notifications,
    loading,
    error,
    refreshNotifications,
    markAsRead,
  } = useNotifications();
  const [actors, setActors] = useState<Record<number, User>>({});

  useFocusEffect(
    useCallback(() => {
      refreshNotifications().catch(() => undefined);
    }, [refreshNotifications]),
  );

  useEffect(() => {
    const missingActorIds = Array.from(
      new Set(
        notifications
          .map(notification => notification.actor_id)
          .filter(actorId => actorId > 0 && !actors[actorId]),
      ),
    );

    if (missingActorIds.length === 0) {
      return;
    }

    let active = true;
    Promise.all(
      missingActorIds.map(async actorId => {
        try {
          return [actorId, await userApi.getUser(actorId)] as const;
        } catch {
          return null;
        }
      }),
    ).then(entries => {
      if (!active) {
        return;
      }

      setActors(previous => {
        const nextActors = { ...previous };
        entries.forEach(entry => {
          if (entry) {
            nextActors[entry[0]] = entry[1];
          }
        });
        return nextActors;
      });
    });

    return () => {
      active = false;
    };
  }, [actors, notifications]);

  async function openNotification(notification: SocialNotification) {
    if (!notification.is_read) {
      await markAsRead(notification.id).catch(() => undefined);
    }

    const actor = actors[notification.actor_id];

    switch (notification.type) {
      case 'message_received':
        navigation.navigate('Chats', {
          screen: 'Chat',
          params: {
            userId: notification.actor_id,
            name: actor?.name || actor?.email || 'Пользователь',
          },
        });
        return;
      case 'friend_request':
        navigation.navigate('Friends');
        return;
      case 'friend_accepted':
        navigation.navigate('UserProfile', {
          userId: notification.actor_id,
          name: actor?.name || actor?.email,
        });
        return;
      case 'post_liked':
      case 'comment_created':
        navigation.navigate('Home');
        return;
      default:
        if (user?.id) {
          navigation.navigate('Profile');
        }
    }
  }

  return (
    <Screen scroll={false} padded={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />
      <FlatList
        data={notifications}
        keyExtractor={item => String(item.id)}
        refreshing={loading && notifications.length > 0}
        onRefresh={refreshNotifications}
        contentContainerStyle={[
          styles.listContent,
          notifications.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          loading ? (
            <LoadingState text="Загружаем уведомления" />
          ) : (
            <EmptyState
              title="Уведомлений пока нет"
              text="Заявки, сообщения и реакции появятся здесь."
            />
          )
        }
        renderItem={({ item }) => {
          const actor = actors[item.actor_id];
          return (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                !item.is_read && styles.rowUnread,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                openNotification(item).catch(() => undefined);
              }}
            >
              <View style={[styles.dot, item.is_read && styles.dotRead]} />
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={2}>
                  {notificationTitle(item, actor)}
                </Text>
                <Text style={styles.details} numberOfLines={1}>
                  {notificationAction(item)} · {formatDateTime(item.created_at)}
                </Text>
              </View>
              {!item.is_read ? <Text style={styles.badge}>new</Text> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.card,
    padding: 14,
  },
  rowUnread: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.selected,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  dotRead: {
    backgroundColor: colors.border,
  },
  meta: {
    flex: 1,
    gap: 5,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  details: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.accent,
    color: colors.white,
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 7,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
});
