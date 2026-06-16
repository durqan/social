import React, { type ReactNode } from 'react';
import { HeaderHeightContext } from '@react-navigation/elements';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { spacing } from '../theme/layout';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  padded?: boolean;
  avoidKeyboard?: boolean;
  keyboardVerticalOffset?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export function Screen({
  children,
  scroll = true,
  style,
  contentContainerStyle,
  edges = ['bottom'],
  padded = true,
  avoidKeyboard = true,
  keyboardVerticalOffset,
  refreshing = false,
  onRefresh,
  onLayout,
}: ScreenProps) {
  const colors = useThemeColors();
  const headerHeight = React.useContext(HeaderHeightContext);
  const styles = createStyles(colors);
  const baseContentStyle = padded ? styles.content : styles.contentFlush;
  const resolvedKeyboardVerticalOffset =
    keyboardVerticalOffset ?? (Platform.OS === 'ios' ? headerHeight ?? 72 : 0);

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
      contentContainerStyle={[baseContentStyle, contentContainerStyle]}>
      {children}
    </ScrollView>
  ) : (
    <View
      style={[baseContentStyle, styles.fixed, contentContainerStyle]}
      onLayout={onLayout}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, style]} edges={edges}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={resolvedKeyboardVerticalOffset}
          style={styles.keyboard}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    keyboard: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: 124,
      gap: spacing.lg,
    },
    contentFlush: {
      padding: 0,
      gap: 0,
    },
    fixed: {
      flex: 1,
    },
  });
