import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bell,
  Heart,
  MessageCircle,
  UserCheck,
  UserPlus,
} from 'lucide-react-native';

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
import { radius, spacing, typography } from '../../theme/layout';
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
  const actorName = actor?.name || 'Пользователь';
  return (
    notificationText[notification.type]?.(actorName) || 'Новое уведомление'
  );
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

function notificationIcon(type: string) {
  switch (type) {
    case 'message_received':
      return MessageCircle;
    case 'friend_request':
      return UserPlus;
    case 'friend_accepted':
      return UserCheck;
    case 'post_liked':
      return Heart;
    default:
      return Bell;
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NotificationsNavigation>();
  const { user } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { notifications, loading, error, refreshNotifications, markAsRead } =
    useNotifications();
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
            name: actor?.name || 'Пользователь',
          },
        });
        return;
      case 'friend_request':
        navigation.navigate('Friends');
        return;
      case 'friend_accepted':
        navigation.navigate('UserProfile', {
          userId: notification.actor_id,
          name: actor?.name || 'Пользователь',
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
    <Screen
      scroll={false}
      padded={false}
      contentContainerStyle={styles.container}
    >
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
          const Icon = notificationIcon(item.type);
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
              <View
                style={[styles.iconBadge, item.is_read && styles.iconBadgeRead]}
              >
                <Icon
                  color={item.is_read ? colors.soft : colors.accentStrong}
                  size={18}
                  strokeWidth={2.2}
                />
              </View>
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
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: 124,
      gap: spacing.sm,
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
      borderRadius: radius.md,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    rowUnread: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.selected,
    },
    rowPressed: {
      backgroundColor: colors.pressed,
    },
    iconBadge: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    iconBadgeRead: {
      backgroundColor: colors.surfaceMuted,
    },
    meta: {
      flex: 1,
      gap: 5,
    },
    title: {
      ...typography.body,
      color: colors.text,
      fontWeight: '800',
    },
    details: {
      ...typography.caption,
      color: colors.muted,
    },
    badge: {
      overflow: 'hidden',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      color: colors.white,
      ...typography.tiny,
      fontWeight: '900',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      textTransform: 'uppercase',
    },
  });
