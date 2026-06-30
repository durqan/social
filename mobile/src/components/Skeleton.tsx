import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing } from '../theme/layout';

type SkeletonBlockProps = {
  width?: ViewStyle['width'];
  height?: ViewStyle['height'];
  radius?: number;
  style?: ViewStyle;
};

export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius: blockRadius = radius.md,
  style,
}: SkeletonBlockProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const translate = useRef(new Animated.Value(-1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      return undefined;
    }

    const loop = Animated.loop(
      Animated.timing(translate, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, translate]);

  const shimmerTranslate = translate.interpolate({
    inputRange: [-1, 1],
    outputRange: [-180, 180],
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: blockRadius },
        style,
      ]}
    >
      {!reduceMotion ? (
        <Animated.View
          style={[
            styles.shimmer,
            {
              transform: [{ translateX: shimmerTranslate }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function ConversationListSkeleton({ count = 7 }: { count?: number }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock width={52} height={52} radius={26} />
          <View style={styles.meta}>
            <SkeletonBlock width="48%" height={16} radius={999} />
            <SkeletonBlock width="82%" height={12} radius={999} />
          </View>
          <SkeletonBlock width={42} height={12} radius={999} />
        </View>
      ))}
    </View>
  );
}

export function FriendsListSkeleton({ count = 5 }: { count?: number }) {
  const styles = createStyles(useThemeColors());

  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.cardRow}>
          <SkeletonBlock width={44} height={44} radius={22} />
          <View style={styles.meta}>
            <SkeletonBlock width="46%" height={16} radius={999} />
            <SkeletonBlock width="62%" height={12} radius={999} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChatMessagesSkeleton({ count = 8 }: { count?: number }) {
  const styles = createStyles(useThemeColors());

  return (
    <View style={styles.chatSkeleton}>
      {Array.from({ length: count }).map((_, index) => {
        const outgoing = index % 3 !== 0;
        return (
          <View
            key={index}
            style={[
              styles.chatSkeletonRow,
              outgoing && styles.chatSkeletonRowOutgoing,
            ]}
          >
            <SkeletonBlock
              width={outgoing ? '64%' : '52%'}
              height={index % 4 === 0 ? 54 : 40}
              radius={18}
            />
          </View>
        );
      })}
    </View>
  );
}

export function WallSkeleton({ count = 3 }: { count?: number }) {
  const styles = createStyles(useThemeColors());

  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.postCard}>
          <View style={styles.row}>
            <SkeletonBlock width={42} height={42} radius={21} />
            <View style={styles.meta}>
              <SkeletonBlock width="44%" height={16} radius={999} />
              <SkeletonBlock width={90} height={12} radius={999} />
            </View>
          </View>
          <SkeletonBlock height={14} radius={999} />
          <SkeletonBlock width="78%" height={14} radius={999} />
          <View style={styles.actions}>
            <SkeletonBlock width={72} height={34} radius={999} />
            <SkeletonBlock width={86} height={34} radius={999} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ProfileSkeleton() {
  const styles = createStyles(useThemeColors());

  return (
    <View style={styles.profileCard}>
      <SkeletonBlock height={92} radius={radius.xl} />
      <SkeletonBlock width={88} height={88} radius={44} style={styles.profileAvatar} />
      <SkeletonBlock width="52%" height={22} radius={999} style={styles.centered} />
      <SkeletonBlock width="68%" height={14} radius={999} style={styles.centered} />
      <SkeletonBlock height={76} radius={radius.xl} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    block: {
      overflow: 'hidden',
      backgroundColor: colors.isDark
        ? 'rgba(148, 163, 184, 0.16)'
        : 'rgba(15, 23, 42, 0.08)',
    },
    shimmer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 96,
      backgroundColor: colors.isDark
        ? 'rgba(255, 255, 255, 0.09)'
        : 'rgba(255, 255, 255, 0.62)',
    },
    list: {
      gap: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    meta: {
      flex: 1,
      gap: spacing.sm,
    },
    chatSkeleton: {
      flex: 1,
      justifyContent: 'flex-end',
      gap: 7,
      paddingHorizontal: 10,
      paddingVertical: spacing.md,
    },
    chatSkeletonRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    chatSkeletonRowOutgoing: {
      justifyContent: 'flex-end',
    },
    postCard: {
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    profileCard: {
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
    },
    profileAvatar: {
      marginTop: -52,
      alignSelf: 'center',
    },
    centered: {
      alignSelf: 'center',
    },
  });
