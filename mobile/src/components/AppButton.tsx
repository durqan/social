import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, typography } from '../theme/layout';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

type AppButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ButtonIcon;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  icon: Icon,
  style,
  ...props
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const textStyle = [styles.text, styles[`${variant}Text`]];
  const iconColor =
    variant === 'primary' || variant === 'danger' ? colors.white : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'danger'
              ? colors.white
              : colors.accent
          }
        />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon color={iconColor} size={17} strokeWidth={2.3} /> : null}
          <Text style={textStyle}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    base: {
      minHeight: 46,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    primary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: colors.isDark ? 0 : 2,
    },
    secondary: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
    danger: {
      backgroundColor: colors.danger,
      borderColor: colors.danger,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: colors.border,
    },
    disabled: {
      opacity: 0.48,
    },
    pressed: {
      opacity: 0.82,
      transform: [{ scale: 0.985 }],
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    text: {
      ...typography.caption,
      fontWeight: '800',
      textAlign: 'center',
    },
    primaryText: {
      color: colors.white,
    },
    secondaryText: {
      color: colors.text,
    },
    dangerText: {
      color: colors.white,
    },
    ghostText: {
      color: colors.text,
    },
  });
