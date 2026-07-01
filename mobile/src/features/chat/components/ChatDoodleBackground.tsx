import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Path,
  Pattern,
  Rect,
} from 'react-native-svg';

type Props = {
  children: ReactNode;
  isDark?: boolean;
};

const patternSize = 112;

export function ChatDoodleBackground({ children, isDark = false }: Props) {
  const patternId = isDark
    ? 'chat-doodle-pattern-dark'
    : 'chat-doodle-pattern-light';
  const backgroundColor = isDark ? '#101914' : '#edf7ed';
  const strokeColor = isDark
    ? 'rgba(203, 232, 214, 0.34)'
    : 'rgba(79, 111, 91, 0.24)';
  const dotColor = isDark
    ? 'rgba(203, 232, 214, 0.16)'
    : 'rgba(79, 111, 91, 0.12)';

  return (
    <View style={[styles.root, { backgroundColor }]}>
      <Svg
        pointerEvents="none"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <Pattern
            id={patternId}
            width={patternSize}
            height={patternSize}
            patternUnits="userSpaceOnUse"
          >
            <G
              fill="none"
              opacity={isDark ? 0.1 : 0.26}
              stroke={strokeColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
            >
              <Path d="M18 24h19a8 8 0 0 1 8 8v5a8 8 0 0 1-8 8h-8l-9 7v-7h-2a8 8 0 0 1-8-8v-5a8 8 0 0 1 8-8Z" />
              <Path d="M25 35h13" />
              <Path d="M66 15c4-5 13-2 13 5 0 8-13 14-13 14S53 28 53 20c0-7 9-10 13-5Z" />
              <Path d="M84 57c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9Z" />
              <Path d="M70 56h.1M80 56h.1M71 61c3 3 7 3 10 0" />
              <Path d="M24 82c7 0 11 4 11 10s-4 10-11 10H13V82h11Z" />
              <Path d="M43 80l14-14M56 67l1 11M56 67l-11 1" />
              <Path d="M86 88l10-10 6 6-10 10-8 2 2-8Z" />
              <Path d="M95 79l6 6" />
            </G>
            <Circle cx={9} cy={68} r={2} fill={dotColor} />
            <Circle cx={102} cy={42} r={2.2} fill={dotColor} />
            <Circle cx={62} cy={100} r={1.8} fill={dotColor} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={backgroundColor} />
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
