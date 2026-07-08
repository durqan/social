import React, { forwardRef, useCallback } from 'react';
import type { ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
} from 'react-native-keyboard-controller';

export type ChatScrollViewRef = React.ElementRef<typeof KeyboardChatScrollView>;

type ChatScrollViewProps = ScrollViewProps &
  KeyboardChatScrollViewProps & {
    chatScrollViewRef?: React.MutableRefObject<ChatScrollViewRef | null>;
  };

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const ChatScrollView = forwardRef<ChatScrollViewRef, ChatScrollViewProps>(
  ({ chatScrollViewRef, ...props }, ref) => {
    const { bottom } = useSafeAreaInsets();
    const combinedRef = useCallback(
      (instance: ChatScrollViewRef | null) => {
        assignRef(ref, instance);
        if (chatScrollViewRef) {
          chatScrollViewRef.current = instance;
        }
      },
      [chatScrollViewRef, ref],
    );

    return (
      <KeyboardChatScrollView
        {...props}
        ref={combinedRef}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="whenAtEnd"
        offset={bottom}
      />
    );
  },
);

ChatScrollView.displayName = 'ChatScrollView';
