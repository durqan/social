import type { ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

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
        <ImageBackground
          source={chatPattern}
          resizeMode="repeat"
          style={StyleSheet.absoluteFill}
          imageStyle={[
            styles.patternImage,
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
    backgroundColor: '#eef8e6',
  },
  rootDark: {
    backgroundColor: '#101914',
  },
  content: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  patternImage: {
    width: undefined,
    height: undefined,
  },
  patternLight: {
    opacity: 0.14,
  },
  patternDark: {
    opacity: 0.06,
  },
});
