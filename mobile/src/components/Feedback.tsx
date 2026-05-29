import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function Notice({
  title,
  text,
}: {
  title: string;
  text?: string;
}) {
  return (
    <View style={styles.noticeBox}>
      <Text style={styles.noticeTitle}>{title}</Text>
      {text ? <Text style={styles.noticeText}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 14,
    lineHeight: 20,
  },
  noticeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  noticeText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
