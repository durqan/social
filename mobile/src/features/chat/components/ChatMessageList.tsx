import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { ChevronDown, MessageCircle } from 'lucide-react-native';
import type { Message } from '../../../api/types';

import { EmptyState } from '../../../components/Feedback';
import { ChatMessagesSkeleton } from '../../../components/Skeleton';
import type { ThemeColors } from '../../../theme/themes';
import { SCROLL_EVENT_THROTTLE_MS } from '../lib/chatScreenConfig';
import { styles, type ChatThemeStyles } from '../lib/chatStyles';

type RenderMessageItem = (info: {
  item: Message;
  index: number;
}) => React.ReactElement | null;

type ChatMessageListProps = {
  listRef: React.RefObject<LegendListRef | null>;
  messages: Message[];
  loading: boolean;
  hasLoaded: boolean;
  refreshing: boolean;
  loadingOlder: boolean;
  playingVoiceUrl: string | null;
  themeColors: ThemeColors;
  themed: ChatThemeStyles;
  currentUserId?: number;
  messageListBottomPadding: number;
  scrollToLatestBottomOffset: number;
  showScrollToLatest: boolean;
  newMessagesBelow: boolean;
  renderScrollComponent: (
    props: ScrollViewProps,
  ) => React.ReactElement<ScrollViewProps>;
  renderMessageItem: RenderMessageItem;
  keyExtractor: (item: Message) => string;
  onRefresh: () => void;
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchMove: (event: GestureResponderEvent) => void;
  onTouchEnd: (event: GestureResponderEvent) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (contentWidth: number, contentHeight: number) => void;
  onScrollToLatest: () => void;
};

export const ChatMessageList = React.memo(function ChatMessageListComponent({
  listRef,
  messages,
  loading,
  hasLoaded,
  refreshing,
  loadingOlder,
  playingVoiceUrl,
  themeColors,
  themed,
  currentUserId,
  messageListBottomPadding,
  scrollToLatestBottomOffset,
  showScrollToLatest,
  newMessagesBelow,
  renderScrollComponent,
  renderMessageItem,
  keyExtractor,
  onRefresh,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onScroll,
  onLayout,
  onContentSizeChange,
  onScrollToLatest,
}: ChatMessageListProps) {
  const listExtraData = useMemo(
    () => ({
      playingVoiceUrl,
      themeColors,
      userId: currentUserId,
    }),
    [currentUserId, playingVoiceUrl, themeColors],
  );

  if (loading && !hasLoaded) {
    return <ChatMessagesSkeleton />;
  }

  return (
    <View style={styles.messageListFrame}>
      <LegendList
        ref={listRef}
        style={[styles.messageListContainer, styles.transparentBackground]}
        data={messages}
        keyExtractor={keyExtractor}
        renderScrollComponent={renderScrollComponent}
        refreshing={refreshing}
        onRefresh={onRefresh}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ data: true, size: true }}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={0.15}
        estimatedItemSize={96}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onScroll={onScroll}
        scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
        renderItem={renderMessageItem}
        extraData={listExtraData}
        onLayout={onLayout}
        contentContainerStyle={[
          styles.messageList,
          styles.transparentBackground,
          { paddingBottom: messageListBottomPadding },
          messages.length === 0 && styles.emptyMessageList,
        ]}
        onContentSizeChange={onContentSizeChange}
        ListHeaderComponent={
          loadingOlder ? (
            <View style={styles.loadingOlder}>
              <ActivityIndicator color={themeColors.accent} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={MessageCircle}
            title="Нет сообщений"
            text="Начните переписку, отправьте изображение или голосовое."
          />
        }
      />

      {showScrollToLatest || newMessagesBelow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            newMessagesBelow ? 'Показать новые сообщения' : 'Прокрутить вниз'
          }
          style={[
            styles.scrollToLatestButton,
            themed.scrollToLatestButton,
            { bottom: scrollToLatestBottomOffset },
            newMessagesBelow && styles.scrollToLatestButtonNew,
            newMessagesBelow && themed.scrollToLatestButtonNew,
          ]}
          onPress={onScrollToLatest}
        >
          {newMessagesBelow ? (
            <Text style={styles.scrollToLatestText}>Новые</Text>
          ) : null}
          <ChevronDown
            color={newMessagesBelow ? themeColors.white : themeColors.text}
            size={18}
            strokeWidth={2.7}
          />
        </Pressable>
      ) : null}
    </View>
  );
});
