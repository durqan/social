import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CommonActions, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MessageCircle,
  Search,
  Pin,
  PinOff,
  Trash2,
  UserPlus,
} from 'lucide-react-native';

import { ApiError, getApiErrorMessage } from '../../api/http';
import { messageApi } from '../../api/messages';
import {
  WS_EVENTS,
  appendConversationPage,
  applyConversationDelta,
  sortConversations,
  type Conversation,
  type ConversationDeltaEvent,
  type ConversationVersionMap,
} from '@social/shared';
import {chatSocket, type WsEvent} from '../../api/ws';
import {
  EmptyState,
  ErrorBanner,
  SuccessBanner,
} from '../../components/Feedback';
import { ConversationListSkeleton } from '../../components/Skeleton';
import { MiniProfileSheet } from '../../components/MiniProfileSheet';
import { Screen } from '../../components/Screen';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;
type LoadMode = 'refresh' | 'silent';
type ConversationFilter = 'all' | 'unread' | 'pinned';
const CONVERSATION_PAGE_SIZE = 50;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function conversationPeerId(conversation: Conversation) {
  const peerId = Number(conversation.user_id);
  return Number.isFinite(peerId) && peerId > 0 ? peerId : null;
}

function conversationOnline(conversation: Conversation) {
  if (!conversation.last_seen_at) {
    return false;
  }

  const timestamp = Date.parse(conversation.last_seen_at);
  return (
    Number.isFinite(timestamp) && Date.now() - timestamp <= ONLINE_WINDOW_MS
  );
}

export default function ChatListScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const { chatRefreshVersion, refreshUnreadCount } = useUnread();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [profileConversation, setProfileConversation] =
    useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ConversationFilter>('all');
  const [busyConversationId, setBusyConversationId] = useState<number | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const activeLoadMoreCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const invalidCursorRecoveryRef = useRef(false);
  const conversationVersionsRef = useRef<ConversationVersionMap>(new Map());
  const hasLoadedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const screenActiveRef = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = setTimeout(() => {
      setSuccess(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timer = setTimeout(() => {
      setError(null);
    }, 3000);

    return () => clearTimeout(timer);
  }, [error]);

  const load = useCallback(
    async (mode: LoadMode | 'more' = 'refresh') => {
      if (mode === 'more') {
        const cursor = nextCursorRef.current;
        if (
          !cursor ||
          loadMoreInFlightRef.current ||
          activeLoadMoreCursorRef.current === cursor
        ) {
          return;
        }
        loadMoreInFlightRef.current = true;
        activeLoadMoreCursorRef.current = cursor;
        setLoadingMore(true);
      } else {
        loadSeq.current += 1;
        loadAbortRef.current?.abort();
        loadMoreAbortRef.current?.abort();
        loadMoreInFlightRef.current = false;
        activeLoadMoreCursorRef.current = null;
        nextCursorRef.current = null;
        setHasMore(false);
        setLoadingMore(false);
        if (mode === 'refresh') {
          if (hasLoadedRef.current) {
            setRefreshing(true);
          } else {
            setLoading(true);
          }
        }
      }

      const requestSeq = loadSeq.current;
      const cursor =
        mode === 'more' ? activeLoadMoreCursorRef.current : null;

      const controller = new AbortController();

      if (mode === 'more') {
        loadMoreAbortRef.current = controller;
      } else {
        loadAbortRef.current = controller;
      }
      setError(null);
      try {
        const page = await messageApi.getConversationsPage(
          {
            limit: CONVERSATION_PAGE_SIZE,
            ...(cursor ? {cursor} : {}),
          },
          {
            signal: controller.signal,
          },
        );
        if (
          !screenActiveRef.current ||
          loadSeq.current !== requestSeq ||
          controller.signal.aborted ||
          (mode === 'more' && activeLoadMoreCursorRef.current !== cursor)
        ) {
          return;
        }
        setConversations(previous => {
          if (mode !== 'more') {
            return sortConversations(page.conversations);
          }
          return appendConversationPage(previous, page.conversations);
        });
        setHasMore(page.has_more);
        nextCursorRef.current = page.next_cursor;
        refreshUnreadCount().catch(() => undefined);
      } catch (apiError) {
        if ((apiError as Error)?.message === 'request aborted') {
          return;
        }
        const shouldRecoverCursor =
          mode === 'more' &&
          apiError instanceof ApiError &&
          apiError.status === 400 &&
          !invalidCursorRecoveryRef.current;
        if (shouldRecoverCursor) {
          invalidCursorRecoveryRef.current = true;
          nextCursorRef.current = null;
          setHasMore(false);
          setTimeout(() => {
            if (screenActiveRef.current) {
              load('silent').catch(() => undefined);
            }
          }, 0);
          return;
        }
        if (screenActiveRef.current && loadSeq.current === requestSeq) {
          setError(getApiErrorMessage(apiError));
        }
      } finally {
        if (mode === 'more') {
          if (loadMoreAbortRef.current === controller) {
            loadMoreAbortRef.current = null;
          }
          if (activeLoadMoreCursorRef.current === cursor) {
            activeLoadMoreCursorRef.current = null;
          }
          loadMoreInFlightRef.current = false;
        } else if (loadAbortRef.current === controller) {
          loadAbortRef.current = null;
        }

        if (screenActiveRef.current) {
          if (mode === 'more') {
            setLoadingMore(false);
          } else if (mode !== 'silent') {
            setLoading(false);
            setRefreshing(false);
          }

          if (loadSeq.current === requestSeq) {
            hasLoadedRef.current = true;
            invalidCursorRecoveryRef.current = false;
            setHasLoaded(true);
          }
        }
      }
    },
    [refreshUnreadCount],
  );

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      load().catch(() => undefined);

      return () => {
        screenActiveRef.current = false;
        loadSeq.current += 1;
        loadAbortRef.current?.abort();
        loadMoreAbortRef.current?.abort();
        loadAbortRef.current = null;
        loadMoreAbortRef.current = null;
        nextCursorRef.current = null;
        activeLoadMoreCursorRef.current = null;
        loadMoreInFlightRef.current = false;
        setHasMore(false);
        setLoadingMore(false);
        setLoading(false);
        setRefreshing(false);
      };
    }, [load]),
  );

  React.useEffect(() => {
    if (!isFocused || chatRefreshVersion === 0) {
      return;
    }

    conversationVersionsRef.current.clear();
    load('silent').catch(() => undefined);
  }, [chatRefreshVersion, isFocused, load]);

  useEffect(() => {
    if (!isFocused) {
      return undefined;
    }

    const unsubscribeMessage = chatSocket.onMessage((event: WsEvent) => {
      if (event.type !== WS_EVENTS.CONVERSATION_DELTA) {
        return;
      }
      setConversations(previous =>
        applyConversationDelta(
          previous,
          event as ConversationDeltaEvent,
          conversationVersionsRef.current,
        ),
      );
    });
    const unsubscribeStatus = chatSocket.onStatus(connected => {
      if (connected && hasConnectedRef.current && screenActiveRef.current) {
        conversationVersionsRef.current.clear();
        load('silent').catch(() => undefined);
      }
      if (connected) {
        hasConnectedRef.current = true;
      }
    });

    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
    };
  }, [isFocused, load]);

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    load('silent').catch(() => undefined);
  });

  const filteredConversations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return conversations.filter(conversation => {
      const matchesFilter =
        activeFilter === 'all' ||
        (activeFilter === 'unread' && conversation.unread_count > 0) ||
        (activeFilter === 'pinned' && conversation.is_pinned);
      if (!matchesFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        conversation.name.toLowerCase().includes(normalizedQuery) ||
        conversation.last_message.toLowerCase().includes(normalizedQuery) ||
        (conversation.last_sender_name || '')
          .toLowerCase()
          .includes(normalizedQuery)
      );
    });
  }, [activeFilter, conversations, searchQuery]);

  const storyConversations = useMemo(
    () => conversations.slice(0, 12),
    [conversations],
  );
  const unreadConversationsCount = useMemo(
    () => conversations.filter(item => item.unread_count > 0).length,
    [conversations],
  );
  const pinnedConversationsCount = useMemo(
    () => conversations.filter(item => item.is_pinned).length,
    [conversations],
  );

  function openConversation(conversation: Conversation) {
    const peerId = conversationPeerId(conversation);
    if (!peerId) {
      setError('Не удалось открыть диалог: не найден собеседник.');
      return;
    }

    setSelectedConversation(null);
    navigation.navigate('Chat', {
      userId: peerId,
      name: conversation.name,
    });
  }

  function openUserSearch() {
    navigation.getParent()?.getParent()?.dispatch(
      CommonActions.navigate({
        name: 'UserSearch',
      }),
    );
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

  function confirmDeleteConversation(conversation: Conversation) {
    setSelectedConversation(null);
    Alert.alert(
      'Удалить переписку?',
      `Диалог с ${conversation.name} будет удалён. Это действие нельзя отменить.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            deleteConversation(conversation).catch(() => undefined);
          },
        },
      ],
    );
  }

  return (
    <Screen
      scroll={false}
      padded={false}
      contentContainerStyle={styles.container}
    >
      {error || success ? (
        <View style={styles.feedback}>
          <ErrorBanner message={error} />
          <SuccessBanner message={success} />
        </View>
      ) : null}

      <FlatList
        data={filteredConversations}
        keyExtractor={item => String(item.user_id)}
        refreshing={refreshing}
        onRefresh={() => {
          load('refresh').catch(() => undefined);
        }}
        onEndReached={() => {
          if (!loadingMore && hasMore) {
            load('more').catch(() => undefined);
          }
        }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={[
          styles.listContent,
          filteredConversations.length === 0 && styles.emptyListContent,
        ]}
        ListHeaderComponent={
          <ChatListHeader
            conversations={storyConversations}
            totalCount={conversations.length}
            unreadCount={unreadConversationsCount}
            pinnedCount={pinnedConversationsCount}
            searchQuery={searchQuery}
            activeFilter={activeFilter}
            onSearchChange={setSearchQuery}
            onFilterChange={setActiveFilter}
            onCreatePress={openUserSearch}
            onOpenConversation={openConversation}
            onOpenProfile={setProfileConversation}
            colors={colors}
          />
        }
        ListEmptyComponent={
          loading && !hasLoaded ? (
            <ConversationListSkeleton />
          ) : searchQuery.trim() || activeFilter !== 'all' ? (
            <EmptyState
              icon={Search}
              title="Ничего не найдено"
              text="Измените запрос или сбросьте фильтр."
            />
          ) : (
            <EmptyState
              icon={MessageCircle}
              title="Пока нет диалогов"
              text="Откройте вкладку Друзья, чтобы начать диалог."
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator color={colors.accentStrong} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ChatListItem
            conversation={item}
            onPress={openConversation}
            onLongPress={setSelectedConversation}
            onOpenProfile={setProfileConversation}
            colors={colors}
          />
        )}
        initialNumToRender={10}
        windowSize={7}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={60}
        removeClippedSubviews
      />

      <ConversationActionSheet
        conversation={selectedConversation}
        busy={busyConversationId === selectedConversation?.user_id}
        onClose={() => setSelectedConversation(null)}
        onOpen={openConversation}
        onTogglePin={conversation => {
          togglePinConversation(conversation).catch(() => undefined);
        }}
        onDelete={confirmDeleteConversation}
        colors={colors}
      />
      <MiniProfileSheet
        visible={Boolean(profileConversation)}
        userId={profileConversation?.user_id}
        user={
          profileConversation
            ? {
                id: profileConversation.user_id,
                name: profileConversation.name,
                avatar: profileConversation.avatar,
                avatar_position_x: profileConversation.avatar_position_x,
                avatar_position_y: profileConversation.avatar_position_y,
                avatar_scale: profileConversation.avatar_scale,
                last_seen_at: profileConversation.last_seen_at,
              }
            : null
        }
        onClose={() => setProfileConversation(null)}
        onOpenProfile={(userId, name) => {
          navigation.getParent()?.getParent()?.dispatch(
            CommonActions.navigate({
              name: 'UserProfile',
              params: { userId, name },
            }),
          );
        }}
        onMessage={(userId, name) => {
          navigation.navigate('Chat', {
            userId,
            name: name || 'Пользователь',
          });
        }}
      />
    </Screen>
  );
}

function ChatListHeader({
  totalCount,
  unreadCount,
  pinnedCount,
  searchQuery,
  activeFilter,
  onSearchChange,
  onFilterChange,
  onCreatePress,
  colors,
}: {
  conversations: Conversation[];
  totalCount: number;
  unreadCount: number;
  pinnedCount: number;
  searchQuery: string;
  activeFilter: ConversationFilter;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onCreatePress: () => void;
  onOpenConversation: (conversation: Conversation) => void;
  onOpenProfile: (conversation: Conversation) => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.headerBlock}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search color={colors.muted} size={19} strokeWidth={2.3} />
          <TextInput
            accessibilityLabel="Поиск по диалогам"
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder="Поиск диалогов"
            placeholderTextColor={colors.soft}
            selectionColor={colors.accent}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Начать новый диалог"
          style={({ pressed }) => [
            styles.createButton,
            pressed && styles.rowPressed,
          ]}
          onPress={onCreatePress}
        >
          <UserPlus color={colors.white} size={21} strokeWidth={2.4} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filterRow}
      >
        <FilterChip
          label="Все"
          count={totalCount}
          selected={activeFilter === 'all'}
          onPress={() => onFilterChange('all')}
          colors={colors}
        />
        <FilterChip
          label="Непрочитанные"
          count={unreadCount}
          selected={activeFilter === 'unread'}
          onPress={() => onFilterChange('unread')}
          colors={colors}
        />
        <FilterChip
          label="Избранные"
          count={pinnedCount}
          selected={activeFilter === 'pinned'}
          onPress={() => onFilterChange('pinned')}
          colors={colors}
        />
      </ScrollView>
    </View>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onPress,
  colors,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityLabel={`${label}: ${count}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.filterChip,
        selected && styles.filterChipSelected,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
        {label}
      </Text>
      {count > 0 ? (
        <View style={[styles.filterCount, selected && styles.filterCountActive]}>
          <Text
            style={[
              styles.filterCountText,
              selected && styles.filterCountTextActive,
            ]}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ChatListItem({
  conversation,
  onPress,
  onLongPress,
  onOpenProfile,
  colors,
}: {
  conversation: Conversation;
  onPress: (conversation: Conversation) => void;
  onLongPress: (conversation: Conversation) => void;
  onOpenProfile: (conversation: Conversation) => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);
  const isUnread = conversation.unread_count > 0;
  const preview = conversation.last_message.trim() || 'Вложение';
  const previewAuthor = conversation.last_is_mine
    ? 'Вы'
    : conversation.last_sender_name || conversation.name || 'Пользователь';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Открывает диалог. Удерживайте, чтобы открыть меню действий."
      style={({ pressed }) => [
        styles.row,
        isUnread && styles.rowUnread,
        pressed && styles.rowPressed,
      ]}
      onPress={() => onPress(conversation)}
      onLongPress={() => onLongPress(conversation)}
      delayLongPress={280}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Открыть мини-профиль"
        onPress={event => {
          event.stopPropagation();
          onOpenProfile(conversation);
        }}
      >
        <ConversationAvatar
          conversation={conversation}
          isUnread={isUnread}
          colors={colors}
          online={conversationOnline(conversation)}
        />
      </Pressable>
      <View style={styles.meta}>
        <View style={styles.rowHeader}>
          <View style={styles.nameBox}>
            {conversation.is_pinned ? (
              <Pin color={colors.accentStrong} size={13} strokeWidth={2.7} />
            ) : null}
            <Text
              style={[styles.name, isUnread && styles.nameUnread]}
              numberOfLines={1}
            >
              {conversation.name}
            </Text>
          </View>
          <Text style={styles.date} numberOfLines={1}>
            {formatDateTime(conversation.last_message_at)}
          </Text>
        </View>
        <Text
          style={[styles.preview, isUnread && styles.previewUnread]}
          numberOfLines={1}
        >
          <Text style={styles.previewAuthor}>{previewAuthor}: </Text>
          {preview}
          {conversation.last_is_mine
            ? ` ${conversation.last_read ? '✓✓' : '✓'}`
            : ''}
        </Text>
      </View>
      {isUnread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{conversation.unread_count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ConversationAvatar({
  conversation,
  isUnread,
  colors,
  online,
  size = 52,
  story = false,
}: {
  conversation: Conversation;
  isUnread: boolean;
  colors: ThemeColors;
  online?: boolean;
  size?: number;
  story?: boolean;
}) {
  const styles = createStyles(colors);
  const avatarUrl = buildAvatarUrl(conversation);
  const avatarSizeStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  const avatarContent = avatarUrl ? (
    <Image
      source={{ uri: avatarUrl }}
      style={[
        styles.avatarImage,
        avatarImageStyle({
          size,
          positionX: conversation.avatar_position_x,
          positionY: conversation.avatar_position_y,
          scale: conversation.avatar_scale,
        }),
        avatarSizeStyle,
      ]}
    />
  ) : (
    <Text style={[styles.avatarText, isUnread && styles.avatarTextUnread]}>
      {conversation.name.slice(0, 1).toUpperCase()}
    </Text>
  );

  if (story) {
    const ringSize = size + 8;
    const gapSize = size + 3;
    return (
      <View style={{ width: ringSize, height: ringSize }}>
          <LinearGradient
            colors={colors.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.storyRing,
              {
                width: ringSize,
                height: ringSize,
                borderRadius: ringSize / 2,
              },
            ]}
          >
            <View
              style={[
                styles.storyGap,
                {
                  width: gapSize,
                  height: gapSize,
                  borderRadius: gapSize / 2,
                  backgroundColor: colors.background,
                },
              ]}
            >
              <View
                style={[
                  styles.avatar,
                  avatarSizeStyle,
                  styles.avatarNoBorder,
                  isUnread && styles.avatarUnread,
                ]}
            >
              {avatarContent}
            </View>
          </View>
        </LinearGradient>
        {online ? <View style={styles.onlineDot} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.avatar, avatarSizeStyle, isUnread && styles.avatarUnread]}>
      {avatarContent}
      {online ? <View style={styles.onlineDot} /> : null}
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
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={Boolean(conversation)}
      transparent
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(
                insets.bottom + spacing.sm,
                spacing.xl,
              ),
            },
          ]}
          onPress={event => event.stopPropagation()}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {conversation?.name || 'Диалог'}
          </Text>

          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetAction,
                busy && styles.sheetActionDisabled,
                pressed && !busy && styles.sheetActionPressed,
              ]}
              disabled={busy}
              onPress={() => onOpen(conversation)}
            >
              <MessageCircle color={colors.muted} size={18} strokeWidth={2.2} />
              <Text style={styles.sheetActionText}>Открыть диалог</Text>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetAction,
                busy && styles.sheetActionDisabled,
                pressed && !busy && styles.sheetActionPressed,
              ]}
              disabled={busy}
              onPress={() => onTogglePin(conversation)}
            >
              {conversation.is_pinned ? (
                <PinOff color={colors.muted} size={18} strokeWidth={2.2} />
              ) : (
                <Pin color={colors.muted} size={18} strokeWidth={2.2} />
              )}
              <Text style={styles.sheetActionText}>
                {conversation.is_pinned ? 'Открепить' : 'Закрепить'}
              </Text>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetAction,
                styles.sheetDangerAction,
                busy && styles.sheetActionDisabled,
                pressed && !busy && styles.sheetActionPressed,
              ]}
              disabled={busy}
              onPress={() => onDelete(conversation)}
            >
              <Trash2 color={colors.danger} size={18} strokeWidth={2.2} />
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
    feedback: {
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: 124,
      gap: spacing.sm,
    },
    emptyListContent: {
      flexGrow: 1,
    },
    headerBlock: {
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    titleRow: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    kicker: {
      ...typography.caption,
      color: colors.accentStrong,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    title: {
      ...typography.h1,
      color: colors.text,
      fontSize: 30,
      lineHeight: 36,
    },
    createButton: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accent,
      shadowColor: colors.accent,
      shadowOpacity: colors.isDark ? 0.14 : 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 1,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    searchBox: {
      flex: 1,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.input,
      paddingHorizontal: spacing.md,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: spacing.sm,
      color: colors.text,
      ...typography.body,
      fontWeight: '700',
    },
    filterRoundButton: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardMuted,
    },
    storyStrip: {
      gap: spacing.md,
      paddingRight: spacing.lg,
      paddingVertical: spacing.xs,
    },
    storyItem: {
      width: 72,
      alignItems: 'center',
      gap: 7,
      position: 'relative',
    },
    storyPressed: {
      opacity: 0.74,
      transform: [{ scale: 0.98 }],
    },
    storyAvatar: {
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.card,
      shadowColor: colors.accent,
      shadowOpacity: 0.34,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    storyAddBadge: {
      position: 'absolute',
      right: 4,
      top: 42,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.background,
    },
    storyName: {
      width: 72,
      ...typography.tiny,
      color: colors.muted,
      fontWeight: '800',
      textAlign: 'center',
    },
    filterRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingRight: spacing.sm,
    },
    filterChip: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingLeft: 14,
      paddingRight: 9,
      backgroundColor: colors.cardMuted,
    },
    filterChipSelected: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.accentSoft,
    },
    filterText: {
      color: colors.muted,
      ...typography.caption,
      fontWeight: '900',
    },
    filterTextSelected: {
      color: colors.text,
    },
    filterCount: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
      backgroundColor: colors.surface,
    },
    filterCountActive: {
      backgroundColor: colors.accent,
    },
    filterCountText: {
      color: colors.muted,
      ...typography.tiny,
      fontWeight: '900',
    },
    filterCountTextActive: {
      color: colors.white,
    },
    loadingMore: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 76,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.md,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.16 : 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: colors.isDark ? 1 : 0,
    },
    rowUnread: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.selected,
      shadowColor: colors.accent,
      shadowOpacity: 0.2,
    },
    rowPressed: {
      opacity: 0.78,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.borderStrong,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.28 : 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: colors.isDark ? 0 : 2,
    },
    avatarNoBorder: {
      borderWidth: 0,
    },
    storyRing: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyGap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarUnread: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    avatarImage: {
      width: 52,
      height: 52,
    },
    avatarText: {
      color: colors.accentStrong,
      fontSize: 18,
      fontWeight: '800',
    },
    avatarTextUnread: {
      color: colors.white,
    },
    onlineDot: {
      position: 'absolute',
      right: 1,
      bottom: 1,
      width: 13,
      height: 13,
      borderRadius: 7,
      backgroundColor: colors.success,
      borderWidth: 2,
      borderColor: colors.background,
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
    nameBox: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    name: {
      ...typography.body,
      flex: 1,
      color: colors.text,
      fontWeight: '900',
    },
    nameUnread: {
      color: colors.text,
    },
    date: {
      ...typography.tiny,
      color: colors.soft,
    },
    preview: {
      ...typography.caption,
      color: colors.muted,
    },
    previewAuthor: {
      fontWeight: '700',
    },
    previewUnread: {
      color: colors.text,
      fontWeight: '700',
    },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      paddingHorizontal: 7,
      shadowColor: colors.accent,
      shadowOpacity: 0.36,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    badgeText: {
      color: colors.white,
      ...typography.tiny,
      fontWeight: '800',
    },
    sheetBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlaySoft,
    },
    sheet: {
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 24,
      gap: 6,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -12 },
      elevation: colors.isDark ? 0 : 8,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 42,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.border,
      marginBottom: 8,
    },
    sheetTitle: {
      color: colors.muted,
      ...typography.caption,
      fontWeight: '700',
      paddingHorizontal: spacing.xs,
      paddingBottom: 4,
      textTransform: 'uppercase',
    },
    sheetAction: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      justifyContent: 'center',
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.cardMuted,
    },
    sheetActionText: {
      flex: 1,
      color: colors.text,
      ...typography.body,
      fontWeight: '700',
    },
    sheetActionPressed: {
      opacity: 0.78,
    },
    sheetActionDisabled: {
      opacity: 0.48,
    },
    sheetDangerAction: {
      marginTop: 2,
      backgroundColor: colors.dangerSoft,
    },
    sheetDangerText: {
      color: colors.danger,
    },
  });
