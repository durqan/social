import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useThemeColors } from '../theme/ThemeContext';
import { radius, touchTarget } from '../theme/layout';
import type { ThemeColors } from '../theme/themes';
import { lightHaptic } from '../utils/haptics';

type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type IconButtonSize = 'sm' | 'md' | 'lg';
type IconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

type IconButtonProps = Omit<PressableProps, 'style'> & {
  icon: IconComponent;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  selected?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon: Icon,
  label,
  variant = 'secondary',
  size = 'md',
  loading = false,
  selected = false,
  disabled,
  haptic = true,
  style,
  onPress,
  ...props
}: IconButtonProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const isDisabled = disabled || loading;
  const iconColor =
    variant === 'primary'
      ? colors.white
      : variant === 'danger'
        ? colors.danger
        : selected
          ? colors.accentStrong
          : colors.text;
  const iconSize = size === 'sm' ? 17 : size === 'lg' ? 23 : 20;

  function handlePress(event: GestureResponderEvent) {
    if (haptic) {
      lightHaptic();
    }

    onPress?.(event);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, selected }}
      disabled={isDisabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        styles[variant],
        selected && styles.selected,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.white : colors.accent}
        />
      ) : (
        <Icon color={iconColor} size={iconSize} strokeWidth={2.35} />
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    base: {
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
    },
    sm: {
      width: touchTarget.sm,
      height: touchTarget.sm,
      borderRadius: radius.pill,
    },
    md: {
      width: touchTarget.md,
      height: touchTarget.md,
      borderRadius: radius.pill,
    },
    lg: {
      width: touchTarget.lg,
      height: touchTarget.lg,
      borderRadius: radius.pill,
    },
    primary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    secondary: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: colors.cardMuted,
      borderColor: colors.border,
    },
    danger: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoft,
    },
    selected: {
      backgroundColor: colors.selected,
      borderColor: colors.accentBorder,
    },
    disabled: {
      opacity: 0.42,
    },
    pressed: {
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
  });
