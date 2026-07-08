import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, touchTarget, typography } from '../theme/layout';
import { lightHaptic } from '../utils/haptics';

type IconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

type CardVariant = 'default' | 'elevated' | 'interactive' | 'danger' | 'muted';

export function Card({
  children,
  style,
  variant = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: CardVariant;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return <View style={[styles.card, styles[`card_${variant}`], style]}>{children}</View>;
}

export function Section({
  title,
  subtitle,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return (
    <View style={[styles.section, style]}>
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
    <Card style={styles.hero} variant="elevated">
      <View pointerEvents="none" style={styles.heroAccentLine} />
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.heroTitle}>{title}</Text>
      {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
      {children}
    </Card>
  );
}

export function ListRow({
  icon: Icon,
  title,
  subtitle,
  rightText,
  accessory,
  danger = false,
  selected = false,
  onPress,
  style,
}: {
  icon?: IconComponent;
  title: string;
  subtitle?: string;
  rightText?: string | number;
  accessory?: ReactNode;
  danger?: boolean;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const content = (
    <>
      {Icon ? (
        <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
          <Icon
            color={danger ? colors.danger : selected ? colors.accentStrong : colors.accent}
            size={18}
            strokeWidth={2.4}
          />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, danger && styles.rowTitleDanger]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory ??
        (rightText !== undefined ? (
          <Text style={[styles.rowRightText, danger && styles.rowTitleDanger]}>
            {rightText}
          </Text>
        ) : onPress ? (
          <ChevronRight color={colors.soft} size={20} strokeWidth={2.4} />
        ) : null)}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.listRow, selected && styles.listRowSelected, style]}>
        {content}
      </View>
    );
  }

  function handlePress(_event: GestureResponderEvent) {
    lightHaptic();
    onPress?.();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.listRow,
        selected && styles.listRowSelected,
        pressed && styles.pressed,
        style,
      ]}
    >
      {content}
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
      shadowOpacity: colors.isDark ? 0.24 : 0.1,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 12 },
      elevation: colors.isDark ? 4 : 2,
    },
    card_default: {},
    card_elevated: {
      borderColor: colors.borderStrong,
      shadowOpacity: colors.isDark ? 0.34 : 0.14,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
      elevation: colors.isDark ? 6 : 4,
    },
    card_interactive: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    card_danger: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoft,
    },
    card_muted: {
      backgroundColor: colors.cardMuted,
      borderColor: colors.border,
      shadowOpacity: colors.isDark ? 0.12 : 0.04,
    },
    section: { gap: spacing.md },
    sectionHeader: { gap: spacing.xs },
    sectionTitle: { ...typography.subtitle, color: colors.textPrimary },
    sectionSubtitle: { ...typography.caption, color: colors.muted },
    hero: {
      gap: spacing.sm,
      padding: spacing.xl,
      overflow: 'hidden',
      borderColor: colors.accentBorder,
      backgroundColor: colors.card,
      position: 'relative',
    },
    heroAccentLine: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 4,
      backgroundColor: colors.accent,
      opacity: 0.72,
    },
    kicker: {
      ...typography.caption,
      color: colors.accentStrong,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    heroTitle: { ...typography.headline, color: colors.textPrimary },
    heroSubtitle: { ...typography.body, color: colors.muted, maxWidth: '92%' },
    pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
    listRow: {
      minHeight: touchTarget.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.cardMuted,
      padding: spacing.md,
    },
    listRowSelected: {
      backgroundColor: colors.selected,
      borderColor: colors.accentBorder,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    rowIconDanger: {
      backgroundColor: colors.dangerSoft,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: {
      ...typography.body,
      color: colors.textPrimary,
      fontWeight: '800',
    },
    rowTitleDanger: {
      color: colors.danger,
    },
    rowSubtitle: {
      marginTop: 2,
      ...typography.caption,
      color: colors.muted,
    },
    rowRightText: {
      ...typography.body,
      color: colors.accentStrong,
      fontWeight: '800',
    },
  });
