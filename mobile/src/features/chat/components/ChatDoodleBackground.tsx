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

import type { ThemeColors, ThemeId } from '../../../theme/themes';

type Props = {
  children: ReactNode;
  theme: ThemeColors;
};

type DoodlePreset = {
  background: string;
  stroke: string;
  dot: string;
  opacity: number;
  strokeWidth: number;
};

const patternSize = 156;

const presets: Record<ThemeId, DoodlePreset> = {
  'aurora-bubble': {
    background: '#F7F9FB',
    stroke: 'rgba(52, 83, 102, 0.34)',
    dot: 'rgba(52, 83, 102, 0.22)',
    opacity: 0.34,
    strokeWidth: 1.35,
  },

  'warm-linen': {
    background: '#FBF1E6',
    stroke: 'rgba(126, 84, 50, 0.30)',
    dot: 'rgba(126, 84, 50, 0.18)',
    opacity: 0.32,
    strokeWidth: 1.35,
  },

  'cosmic-indigo': {
    background: '#050816',
    stroke: 'rgba(205, 212, 255, 0.95)',
    dot: 'rgba(205, 212, 255, 0.45)',
    opacity: 0.26,
    strokeWidth: 1.35,
  },

  'neon-social': {
    background: '#070816',
    stroke: 'rgba(238, 222, 255, 0.95)',
    dot: 'rgba(236, 72, 153, 0.55)',
    opacity: 0.27,
    strokeWidth: 1.35,
  },

  'mono-premium': {
    background: '#060708',
    stroke: 'rgba(255, 255, 255, 0.86)',
    dot: 'rgba(255, 255, 255, 0.38)',
    opacity: 0.22,
    strokeWidth: 1.25,
  },
};

export function ChatDoodleBackground({ children, theme }: Props) {
  const preset = presets[theme.id];
  const patternId = `chat-doodle-${theme.id}`;

  return (
      <View style={[styles.root, { backgroundColor: preset.background }]}>
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
                  opacity={preset.opacity}
                  stroke={preset.stroke}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={preset.strokeWidth}
              >
                {/* chat bubble */}
                <Path d="M18 22h28a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10H34l-12 9v-9h-4A10 10 0 0 1 8 40v-8a10 10 0 0 1 10-10Z" />
                <Path d="M24 34h23" />
                <Path d="M24 42h14" />

                {/* heart */}
                <Path d="M92 18c4-6 15-3 15 6 0 10-15 17-15 17S77 34 77 24c0-9 11-12 15-6Z" />

                {/* smile */}
                <Path d="M133 42a14 14 0 1 1-28 0 14 14 0 0 1 28 0Z" />
                <Path d="M115 40h.1" />
                <Path d="M124 40h.1" />
                <Path d="M116 48c3 3 7 3 10 0" />

                {/* paper plane */}
                <Path d="M35 96l36-17-12 36-8-15-16-4Z" />
                <Path d="M51 100l20-21" />

                {/* music */}
                <Path d="M100 91V61l23-5v29" />
                <Path d="M100 91c0 5-5 9-10 9s-9-3-9-7 4-7 9-7c4 0 8 2 10 5Z" />
                <Path d="M123 85c0 5-5 9-10 9s-9-3-9-7 4-7 9-7c4 0 8 2 10 5Z" />

                {/* camera */}
                <Path d="M20 122h35a8 8 0 0 1 8 8v13a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8v-13a8 8 0 0 1 8-8Z" />
                <Path d="M28 122l4-7h14l4 7" />
                <Path d="M46 136a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />

                {/* pencil */}
                <Path d="M105 128l18-18 9 9-18 18-12 3 3-12Z" />
                <Path d="M122 111l9 9" />

                {/* stars / small marks */}
                <Path d="M143 88l4 7 7 4-7 4-4 7-4-7-7-4 7-4 4-7Z" />
                <Path d="M73 23l3 5 5 3-5 3-3 5-3-5-5-3 5-3 3-5Z" />
                <Path d="M76 132l5 7" />
                <Path d="M85 129l-7 5" />
              </G>

              <Circle cx={72} cy={64} r={1.7} fill={preset.dot} />
              <Circle cx={142} cy={18} r={1.5} fill={preset.dot} />
              <Circle cx={14} cy={78} r={1.4} fill={preset.dot} />
              <Circle cx={136} cy={138} r={1.6} fill={preset.dot} />
            </Pattern>
          </Defs>

          <Rect width="100%" height="100%" fill={preset.background} />
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