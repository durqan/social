import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, typography } from '../theme/layout';

export function ErrorBanner({ message }: { message?: string | null }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (!message) {
    return null;
  }

  return (
    <View style={styles.errorBox}>
      <View style={[styles.bannerMarker, styles.errorMarker]} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message }: { message?: string | null }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (!message) {
    return null;
  }

  return (
    <View style={styles.successBox}>
      <View style={[styles.bannerMarker, styles.successMarker]} />
      <Text style={styles.successText}>{message}</Text>
    </View>
  );
}

export function Notice({ title, text }: { title: string; text?: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.noticeBox}>
      <Text style={styles.noticeTitle}>{title}</Text>
      {text ? <Text style={styles.noticeText}>{text}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </View>
  );
}

export function LoadingState({ text }: { text: string }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.loadingBox}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.loadingText}>{text}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: 'rgba(255,59,48,0.18)',
      borderRadius: radius.xl,
      backgroundColor: colors.dangerSoft,
      padding: spacing.md,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      ...typography.caption,
      fontWeight: '700',
    },
    successBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: 'rgba(33,166,122,0.18)',
      borderRadius: radius.xl,
      backgroundColor: colors.successSoft,
      padding: spacing.md,
    },
    successText: {
      flex: 1,
      color: colors.success,
      ...typography.caption,
      fontWeight: '700',
    },
    bannerMarker: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    errorMarker: {
      backgroundColor: colors.danger,
    },
    successMarker: {
      backgroundColor: colors.success,
    },
    noticeBox: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.xs,
    },
    noticeTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '800',
    },
    noticeText: {
      color: colors.muted,
      ...typography.caption,
    },
    emptyBox: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xxl,
      gap: spacing.xs,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: colors.isDark ? 0 : 1,
    },
    emptyTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '800',
      textAlign: 'center',
    },
    emptyText: {
      color: colors.muted,
      ...typography.caption,
      textAlign: 'center',
    },
    loadingBox: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      padding: spacing.xl,
      gap: spacing.sm,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: colors.isDark ? 0 : 1,
    },
    loadingText: {
      color: colors.muted,
      ...typography.caption,
      textAlign: 'center',
    },
  });
