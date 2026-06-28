import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { elevation, radius, spacing, typography } from '../theme/layout';

type TileIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.section}>
      {title || subtitle ? (
        <View style={styles.sectionHeader}>
          {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
          {subtitle ? (
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function HeroCard({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <Card style={styles.hero}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.heroTitle}>{title}</Text>
      {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
      {children}
    </Card>
  );
}

export function ActionTile({
  title,
  text,
  emoji,
  icon: Icon,
  onPress,
}: {
  title: string;
  text?: string;
  emoji?: string;
  icon?: TileIcon;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.tileIcon}>
        {Icon ? (
          <Icon color={colors.accentStrong} size={18} strokeWidth={2.2} />
        ) : (
          <Text style={styles.tileEmoji}>{emoji || '•'}</Text>
        )}
      </View>
      <View style={styles.tileTextBox}>
        <Text style={styles.tileTitle}>{title}</Text>
        {text ? <Text style={styles.tileText}>{text}</Text> : null}
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.lg,
      shadowColor: colors.shadow,
      ...(colors.isDark ? elevation.none : elevation.card),
    },
    section: { gap: spacing.md },
    sectionHeader: { gap: spacing.xs },
    sectionTitle: { ...typography.h3, color: colors.text },
    sectionSubtitle: { ...typography.caption, color: colors.muted },
    hero: {
      gap: spacing.sm,
      padding: spacing.xl,
      overflow: 'hidden',
      borderColor: colors.accentBorder,
      backgroundColor: colors.surface,
    },
    kicker: {
      ...typography.caption,
      color: colors.accentStrong,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    heroTitle: { ...typography.h1, color: colors.text },
    heroSubtitle: { ...typography.body, color: colors.muted },
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      minHeight: 88,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.sm,
    },
    pressed: { backgroundColor: colors.pressed, transform: [{ scale: 0.99 }] },
    tileIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    tileEmoji: { fontSize: 17, lineHeight: 20 },
    tileTextBox: { gap: 2 },
    tileTitle: { ...typography.body, color: colors.text, fontWeight: '800' },
    tileText: { ...typography.caption, color: colors.muted },
  });
