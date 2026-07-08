import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import type { Message, PinnedMessage } from '@social/shared';

import { styles, type ChatThemeStyles } from '../lib/chatStyles';
import { messagePreviewText } from '../lib/chatUtils';

type ChatPinnedMessageBarProps = {
  pinnedMessage: PinnedMessage | null;
  messages: Message[];
  listRef: React.RefObject<LegendListRef | null>;
  themed: ChatThemeStyles;
  onUnpin: () => void;
};

export function ChatPinnedMessageBar({
  pinnedMessage,
  messages,
  listRef,
  themed,
  onUnpin,
}: ChatPinnedMessageBarProps) {
  if (!pinnedMessage?.message) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.pinnedBar, themed.card]}
      onPress={() => {
        const targetId = pinnedMessage.message_id;
        const index = messages.findIndex(message => message.id === targetId);
        if (index >= 0) {
          listRef.current?.scrollToIndex({ index, animated: true });
        }
      }}
      onLongPress={onUnpin}
    >
      <View style={[styles.pinnedStripe, themed.accentBg]} />
      <View style={styles.pinnedInfo}>
        <Text style={[styles.pinnedTitle, themed.accentText]}>
          Закрепленное сообщение
        </Text>
        <Text style={[styles.pinnedText, themed.text]} numberOfLines={1}>
          {messagePreviewText(pinnedMessage.message)}
        </Text>
      </View>
      <Text style={[styles.pinnedHint, themed.softText]}>удерж. снять</Text>
    </Pressable>
  );
}
