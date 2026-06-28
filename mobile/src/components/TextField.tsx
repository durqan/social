import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, typography } from '../theme/layout';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
};

export function TextField({ label, error, style, ...props }: TextFieldProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.soft}
        autoCapitalize="none"
        style={[
          styles.input,
          focused && styles.inputFocused,
          error && styles.inputError,
          style,
        ]}
        {...props}
        onFocus={event => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          props.onBlur?.(event);
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      gap: 6,
    },
    label: {
      ...typography.caption,
      color: colors.muted,
      fontWeight: '700',
      paddingHorizontal: 2,
    },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.input,
      color: colors.text,
      ...typography.body,
    },
    inputFocused: {
      borderColor: colors.accentBorder,
      backgroundColor: colors.inputFocus,
      shadowColor: colors.accent,
      shadowOpacity: colors.isDark ? 0 : 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    inputError: {
      borderColor: colors.danger,
    },
    error: {
      color: colors.danger,
      ...typography.caption,
    },
  });
