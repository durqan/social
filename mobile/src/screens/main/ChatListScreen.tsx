import React, { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getApiErrorMessage } from '../../api/http';
import { messageApi } from '../../api/messages';
import type { Conversation } from '../../api/types';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useUnread } from '../../context/UnreadContext';
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;
type LoadMode = 'refresh' | 'silent';

export default function ChatListScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const { chatRefreshVersion, refreshUnreadCount } = useUnread();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (mode: LoadMode = 'refresh') => {
      if (mode !== 'silent') {
        setLoading(true);
      }
      setError(null);
      try {
        const nextConversations = await messageApi.getConversations();
        setConversations(nextConversations);
        refreshUnreadCount().catch(() => undefined);
      } catch (apiError) {
        setError(getApiErrorMessage(apiError));
      } finally {
        setHasLoaded(true);
        if (mode !== 'silent') {
          setLoading(false);
        }
      }
    },
    [refreshUnreadCount],
  );

  const scheduleRealtimeRefresh = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      load('silent').catch(() => undefined);
    }, 250);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);

      return () => {
        if (refreshTimer.current) {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = null;
        }
      };
    }, [load]),
  );

  React.useEffect(() => {
    if (!isFocused || chatRefreshVersion === 0) {
      return;
    }

    scheduleRealtimeRefresh();
  }, [chatRefreshVersion, isFocused, scheduleRealtimeRefresh]);

  function openConversation(conversation: Conversation) {
    navigation.navigate('Chat', {
      userId: conversation.user_id,
      name: conversation.name,
    });
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />

      <FlatList
        data={conversations}
        keyExtractor={item => String(item.user_id)}
        refreshing={loading && hasLoaded}
        onRefresh={load}
        contentContainerStyle={[
          styles.listContent,
          conversations.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          loading && !hasLoaded ? (
            <LoadingState text="Загружаем чаты" />
          ) : (
            <EmptyState
              title="Чатов пока нет"
              text="Откройте вкладку Друзья, чтобы начать диалог."
            />
          )
        }
        renderItem={({ item }) => {
          const isUnread = item.unread_count > 0;
          const preview = item.last_message.trim() || 'Изображение';

          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                isUnread && styles.rowUnread,
                pressed && styles.rowPressed,
              ]}
              onPress={() => openConversation(item)}
            >
              <View style={[styles.avatar, isUnread && styles.avatarUnread]}>
                <Text style={styles.avatarText}>
                  {item.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.meta}>
                <View style={styles.rowHeader}>
                  <Text
                    style={[styles.name, isUnread && styles.nameUnread]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text style={styles.date} numberOfLines={1}>
                    {formatDateTime(item.last_message_at)}
                  </Text>
                </View>
                <Text
                  style={[styles.preview, isUnread && styles.previewUnread]}
                  numberOfLines={1}
                >
                  {preview}
                </Text>
              </View>
              {isUnread ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread_count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 0,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 12,
  },
  rowUnread: {
    borderColor: 'rgba(34, 158, 217, 0.36)',
    backgroundColor: '#f8fcff',
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarUnread: {
    backgroundColor: colors.accentStrong,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  nameUnread: {
    color: colors.accentStrong,
  },
  date: {
    color: colors.soft,
    fontSize: 12,
  },
  preview: {
    color: colors.muted,
    fontSize: 14,
  },
  previewUnread: {
    color: colors.text,
    fontWeight: '700',
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 7,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
});
