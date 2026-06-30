import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';

const chatPattern =
  require('../../../assets/patterns/social-chat-doodle-pattern.png') as number;

type Props = {
  children: ReactNode;
  isDark?: boolean;
};

export function ChatDoodleBackground({ children, isDark = false }: Props) {
  return (
    <View style={[styles.root, isDark ? styles.rootDark : styles.rootLight]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={chatPattern}
          resizeMode="repeat"
          style={[
            styles.pattern,
            isDark ? styles.patternDark : styles.patternLight,
          ]}
        />
      </View>

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  rootLight: {
    backgroundColor: '#dcefb5',
  },
  rootDark: {
    backgroundColor: '#17251f',
  },
  content: {
    flex: 1,
  },
  pattern: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  patternLight: {
    opacity: 0.14,
  },
  patternDark: {
    opacity: 0.06,
  },
});
