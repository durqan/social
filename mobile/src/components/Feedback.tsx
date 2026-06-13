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
      borderWidth: 1,
      borderColor: colors.dangerSoft,
      borderRadius: radius.lg,
      backgroundColor: colors.dangerSoft,
      padding: spacing.md,
    },
    errorText: {
      color: colors.danger,
      ...typography.caption,
      fontWeight: '700',
    },
    successBox: {
      borderWidth: 1,
      borderColor: colors.successSoft,
      borderRadius: radius.lg,
      backgroundColor: colors.successSoft,
      padding: spacing.md,
    },
    successText: {
      color: colors.success,
      ...typography.caption,
      fontWeight: '700',
    },
    noticeBox: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
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
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xxl,
      gap: spacing.xs,
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
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.muted,
      ...typography.caption,
      textAlign: 'center',
    },
  });
