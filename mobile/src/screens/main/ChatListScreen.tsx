import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getApiErrorMessage } from '../../api/http';
import { messageApi } from '../../api/messages';
import type { Conversation } from '../../api/types';
import { assetURL } from '../../config/env';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { formatDateTime } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;
type LoadMode = 'refresh' | 'silent';

function conversationTimestamp(conversation: Conversation) {
  const timestamp = Date.parse(conversation.last_message_at || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((first, second) => {
    if (first.is_pinned !== second.is_pinned) {
      return first.is_pinned ? -1 : 1;
    }

    return conversationTimestamp(second) - conversationTimestamp(first);
  });
}

export default function ChatListScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const { chatRefreshVersion, refreshUnreadCount } = useUnread();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [busyConversationId, setBusyConversationId] = useState<number | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
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
        setConversations(sortConversations(nextConversations));
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
    setSelectedConversation(null);
    navigation.navigate('Chat', {
      userId: conversation.user_id,
      name: conversation.name,
    });
  }

  async function togglePinConversation(conversation: Conversation) {
    setBusyConversationId(conversation.user_id);
    setError(null);
    setSuccess(null);

    const nextPinned = !conversation.is_pinned;
    const previousConversations = conversations;
    setConversations(current =>
      sortConversations(
        current.map(item =>
          item.user_id === conversation.user_id
            ? { ...item, is_pinned: nextPinned }
            : item,
        ),
      ),
    );

    try {
      if (nextPinned) {
        await messageApi.pinConversation(conversation.user_id);
        setSuccess('Диалог закреплен');
      } else {
        await messageApi.unpinConversation(conversation.user_id);
        setSuccess('Закреп снят');
      }
      setSelectedConversation(null);
    } catch (apiError) {
      setConversations(previousConversations);
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyConversationId(null);
    }
  }

  async function deleteConversation(conversation: Conversation) {
    setBusyConversationId(conversation.user_id);
    setError(null);
    setSuccess(null);
    try {
      await messageApi.deleteConversationWith(conversation.user_id);
      setConversations(current =>
        current.filter(item => item.user_id !== conversation.user_id),
      );
      setSelectedConversation(null);
      setSuccess('Переписка удалена');
      refreshUnreadCount().catch(() => undefined);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyConversationId(null);
    }
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

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
          const previewAuthor = item.last_is_mine
            ? 'Вы'
            : item.last_sender_name || item.name || 'Пользователь';

          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                isUnread && styles.rowUnread,
                pressed && styles.rowPressed,
              ]}
              onPress={() => openConversation(item)}
              onLongPress={() => setSelectedConversation(item)}
              delayLongPress={280}
            >
              <ConversationAvatar
                conversation={item}
                isUnread={isUnread}
                colors={colors}
              />
              <View style={styles.meta}>
                <View style={styles.rowHeader}>
                  <Text
                    style={[styles.name, isUnread && styles.nameUnread]}
                    numberOfLines={1}
                  >
                    {item.is_pinned ? '● ' : ''}
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
                  <Text style={styles.previewAuthor}>{previewAuthor}: </Text>
                  {preview}
                  {item.last_is_mine ? ` ${item.last_read ? '✓✓' : '✓'}` : ''}
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

      <ConversationActionSheet
        conversation={selectedConversation}
        busy={busyConversationId === selectedConversation?.user_id}
        onClose={() => setSelectedConversation(null)}
        onOpen={openConversation}
        onTogglePin={conversation => {
          togglePinConversation(conversation).catch(() => undefined);
        }}
        onDelete={conversation => {
          deleteConversation(conversation).catch(() => undefined);
        }}
        colors={colors}
      />
    </Screen>
  );
}

function ConversationAvatar({
  conversation,
  isUnread,
  colors,
}: {
  conversation: Conversation;
  isUnread: boolean;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <View style={[styles.avatar, isUnread && styles.avatarUnread]}>
      {conversation.avatar ? (
        <Image
          source={{ uri: assetURL(conversation.avatar) }}
          style={styles.avatarImage}
        />
      ) : (
        <Text style={styles.avatarText}>
          {conversation.name.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function ConversationActionSheet({
  conversation,
  busy,
  onClose,
  onOpen,
  onTogglePin,
  onDelete,
  colors,
}: {
  conversation: Conversation | null;
  busy: boolean;
  onClose: () => void;
  onOpen: (conversation: Conversation) => void;
  onTogglePin: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <Modal
      visible={Boolean(conversation)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{conversation?.name || 'Диалог'}</Text>

          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={styles.sheetAction}
              disabled={busy}
              onPress={() => onOpen(conversation)}
            >
              <Text style={styles.sheetActionText}>Открыть диалог</Text>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={styles.sheetAction}
              disabled={busy}
              onPress={() => onTogglePin(conversation)}
            >
              <Text style={styles.sheetActionText}>
                {conversation.is_pinned ? 'Открепить' : 'Закрепить'}
              </Text>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.sheetAction, styles.sheetDangerAction]}
              disabled={busy}
              onPress={() => onDelete(conversation)}
            >
              <Text style={[styles.sheetActionText, styles.sheetDangerText]}>
                Удалить переписку
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    borderColor: colors.accentBorder,
    backgroundColor: colors.selected,
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
    overflow: 'hidden',
  },
  avatarUnread: {
    backgroundColor: colors.accentStrong,
  },
  avatarImage: {
    width: 48,
    height: 48,
  },
  avatarText: {
    color: colors.white,
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
  previewAuthor: {
    fontWeight: '700',
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
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 4,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  sheetTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  sheetAction: {
    minHeight: 52,
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  sheetActionText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  sheetDangerAction: {
    marginTop: 2,
    backgroundColor: colors.dangerSoft,
  },
  sheetDangerText: {
    color: colors.danger,
  },
});
