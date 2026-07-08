import React from 'react';
import { Pressable, Text } from 'react-native';

import { styles } from '../lib/chatStyles';

type ChatHeaderTitleButtonProps = {
  name: string;
  textColor: string;
  onPress: () => void;
};

export function ChatHeaderTitleButton({
  name,
  textColor,
  onPress,
}: ChatHeaderTitleButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть мини-профиль"
      style={styles.chatHeaderTitleButton}
      onPress={onPress}
    >
      <Text
        style={[styles.chatHeaderTitleText, { color: textColor }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </Pressable>
  );
}
