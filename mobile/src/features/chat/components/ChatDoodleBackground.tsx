import type { ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const chatPattern =
  require('../../../assets/patterns/social-chat-doodle-pattern.png') as number;

type Props = {
  children: ReactNode;
  isDark?: boolean;
};

export function ChatDoodleBackground({ children, isDark = false }: Props) {
  const gradientId = isDark
    ? 'chat-background-gradient-dark'
    : 'chat-background-gradient-light';
  const gradientStops = isDark
    ? ['#101914', '#13211d', '#101f21']
    : ['#f4faef', '#eef7f0', '#edf8f7'];

  return (
    <View style={[styles.root, isDark ? styles.rootDark : styles.rootLight]}>
      <Svg
        pointerEvents="none"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradientStops[0]} />
            <Stop offset="0.55" stopColor={gradientStops[1]} />
            <Stop offset="1" stopColor={gradientStops[2]} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>

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
