import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bell,
  Heart,
  MessageCircle,
  Phone,
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
import { useNotifications } from '../../context/NotificationsContext';
import type {
  MainStackParamList,
  MainTabParamList,
} from '../../navigation/types';
import {
  navigateTabNotificationRoute,
  notificationRouteFromPayload,
} from '../../notifications/navigation';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

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
  incoming_call: actorName => `${actorName} звонил(а) вам`,
};
const markSeenDelayMs = 750;

type NotificationListItem = {
  notification: SocialNotification;
  count: number;
  seenIds: number[];
};

function messageConversationId(notification: SocialNotification) {
  return notification.conversation_id || notification.actor_id;
}

function groupNotificationsForDisplay(notifications: SocialNotification[]) {
  const grouped: NotificationListItem[] = [];
  const messageGroups = new Map<number, NotificationListItem>();

  notifications.forEach(notification => {
    if (notification.type !== 'message_received') {
      grouped.push({
        notification,
        count: 1,
        seenIds: [notification.id],
      });
      return;
    }

    const conversationId = messageConversationId(notification);
    const existing = messageGroups.get(conversationId);
    if (existing) {
      existing.count += 1;
      existing.seenIds.push(notification.id);
      if (
        new Date(notification.created_at).getTime() >
        new Date(existing.notification.created_at).getTime()
      ) {
        existing.notification = notification;
      }
      return;
    }

    const item = {
      notification,
      count: 1,
      seenIds: [notification.id],
    };
    messageGroups.set(conversationId, item);
    grouped.push(item);
  });

  return grouped;
}

function notificationTitle(notification: SocialNotification, actor?: User) {
  const actorName = actor?.name || 'Пользователь';
  return (
    notificationText[notification.type]?.(actorName) || 'Новое уведомление'
  );
}

function notificationListTitle(item: NotificationListItem, actor?: User) {
  if (item.notification.type === 'message_received' && item.count > 1) {
    return `${actor?.name || 'Пользователь'}: ${item.count} новых сообщений`;
  }

  return notificationTitle(item.notification, actor);
}

function notificationAction(notification: SocialNotification) {
  switch (notification.type) {
    case 'message_received':
      return 'Открыть чат';
    case 'incoming_call':
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
    case 'incoming_call':
      return Phone;
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
  const isFocused = useIsFocused();
  const navigation = useNavigation<NotificationsNavigation>();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { notifications, loading, error, refreshNotifications, markAsRead, markAsSeen } =
    useNotifications();
  const [actors, setActors] = useState<Record<number, User>>({});
  const [hasLoaded, setHasLoaded] = useState(false);
  const displayNotifications = useMemo(
    () => groupNotificationsForDisplay(notifications),
    [notifications],
  );

  const loadNotifications = useCallback(async () => {
    try {
      await refreshNotifications();
    } finally {
      setHasLoaded(true);
    }
  }, [refreshNotifications]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications().catch(() => undefined);
    }, [loadNotifications]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    loadNotifications().catch(() => undefined);
  });

  useEffect(() => {
    const missingActorIds = Array.from(
      new Set(
        displayNotifications
          .map(item => item.notification)
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
  }, [actors, displayNotifications]);

  useEffect(() => {
    if (!isFocused || displayNotifications.length === 0) {
      return;
    }

    const unseenIds = Array.from(
      new Set(
        displayNotifications
          .flatMap(item => item.seenIds)
          .filter(id =>
            notifications.some(
              notification => notification.id === id && !notification.is_seen,
            ),
          ),
      ),
    );
    if (unseenIds.length === 0) {
      return;
    }

    const timeout = setTimeout(() => {
      markAsSeen(unseenIds).catch(() => undefined);
    }, markSeenDelayMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [displayNotifications, isFocused, markAsSeen, notifications]);

  async function openNotification(notification: SocialNotification) {
    if (!notification.is_read) {
      await markAsRead(notification.id).catch(() => undefined);
    }

    const actor = actors[notification.actor_id];
    navigateTabNotificationRoute(
      navigation,
      notificationRouteFromPayload(
        {
          type: notification.type,
          actorId: notification.actor_id,
          entityId: notification.entity_id,
          conversationId: notification.conversation_id,
          callId: notification.call_id,
        },
        {
          actorName: actor?.name || 'Пользователь',
        },
      ),
    );
  }

  return (
    <Screen
      scroll={false}
      padded={false}
      contentContainerStyle={styles.container}
    >
      <ErrorBanner message={error} />
      <FlatList
        data={displayNotifications}
        keyExtractor={item => String(item.notification.id)}
        refreshing={loading && hasLoaded}
        onRefresh={loadNotifications}
        contentContainerStyle={[
          styles.listContent,
          displayNotifications.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          loading && !hasLoaded ? (
            <LoadingState text="Загружаем уведомления" />
          ) : (
            <EmptyState
              title="Уведомлений пока нет"
              text="Заявки, сообщения и реакции появятся здесь."
            />
          )
        }
        renderItem={({ item }) => {
          const notification = item.notification;
          const actor = actors[notification.actor_id];
          const Icon = notificationIcon(notification.type);
          return (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                !notification.is_read && styles.rowUnread,
                pressed && styles.rowPressed,
              ]}
              onPress={() => {
                openNotification(notification).catch(() => undefined);
              }}
            >
              <View
                style={[styles.iconBadge, notification.is_read && styles.iconBadgeRead]}
              >
                <Icon
                  color={notification.is_read ? colors.soft : colors.accentStrong}
                  size={18}
                  strokeWidth={2.2}
                />
              </View>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={2}>
                  {notificationListTitle(item, actor)}
                </Text>
                <Text style={styles.details} numberOfLines={1}>
                  {notificationAction(notification)} · {formatDateTime(notification.created_at)}
                </Text>
              </View>
              {!notification.is_read ? <View style={styles.unreadDot} /> : null}
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
      borderRadius: radius.lg,
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
    unreadDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.accent,
    },
  });
