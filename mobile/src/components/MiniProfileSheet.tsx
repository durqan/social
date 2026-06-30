import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MessageCircle, Phone, UserRound } from 'lucide-react-native';

import type { User } from '../api/types';
import { userApi } from '../api/users';
import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, typography } from '../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../utils/avatar';
import { formatDateTime } from '../utils/format';

type MiniProfileSheetProps = {
  userId?: number | null;
  user?: User | null;
  visible: boolean;
  onClose: () => void;
  onOpenProfile: (userId: number, name?: string) => void;
  onMessage?: (userId: number, name?: string) => void;
  onCall?: (userId: number, name?: string) => void;
};

export function MiniProfileSheet({
  userId,
  user,
  visible,
  onClose,
  onOpenProfile,
  onMessage,
  onCall,
}: MiniProfileSheetProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [loadedUser, setLoadedUser] = useState<User | null>(user ?? null);

  useEffect(() => {
    setLoadedUser(user ?? null);
  }, [user, userId]);

  useEffect(() => {
    if (!visible || !userId) {
      return undefined;
    }

    let cancelled = false;
    userApi
      .getUser(userId)
      .then(nextUser => {
        if (!cancelled) {
          setLoadedUser(nextUser);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userId, visible]);

  const profile = loadedUser ?? user ?? null;
  const targetId = profile?.id ?? userId;
  const avatarUrl = buildAvatarUrl(profile ?? undefined);
  const displayName = profile?.name || profile?.email || 'Пользователь';
  const status = profile?.last_seen_at
    ? `Был(а) ${formatDateTime(profile.last_seen_at)}`
    : 'Статус не указан';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.avatar}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={[
                    styles.avatarImage,
                    avatarImageStyle({
                      size: 64,
                      positionX: profile?.avatarPositionX,
                      positionY: profile?.avatarPositionY,
                      scale: profile?.avatarScale,
                    }),
                  ]}
                />
              ) : (
                <Text style={styles.avatarText}>
                  {displayName.slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.status} numberOfLines={1}>
                {status}
              </Text>
              {profile?.email ? (
                <Text style={styles.email} numberOfLines={1}>
                  {profile.email}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.actions}>
            {targetId ? (
              <SheetAction
                icon={UserRound}
                label="Профиль"
                colors={colors}
                onPress={() => {
                  onClose();
                  onOpenProfile(targetId, displayName);
                }}
              />
            ) : null}
            {targetId && onMessage ? (
              <SheetAction
                icon={MessageCircle}
                label="Написать"
                primary
                colors={colors}
                onPress={() => {
                  onClose();
                  onMessage(targetId, displayName);
                }}
              />
            ) : null}
            {targetId && onCall ? (
              <SheetAction
                icon={Phone}
                label="Позвонить"
                colors={colors}
                onPress={() => {
                  onClose();
                  onCall(targetId, displayName);
                }}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({
  icon: Icon,
  label,
  primary = false,
  colors,
  onPress,
}: {
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  label: string;
  primary?: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const styles = createStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.actionPressed,
      ]}
      onPress={onPress}
    >
      <Icon
        color={primary ? colors.white : colors.text}
        size={18}
        strokeWidth={2.35}
      />
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.overlaySoft,
    },
    sheet: {
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 26,
      gap: spacing.md,
    },
    handle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
      borderWidth: 2,
      borderColor: colors.white,
    },
    avatarImage: {
      width: 64,
      height: 64,
    },
    avatarText: {
      color: colors.accentStrong,
      fontSize: 24,
      fontWeight: '900',
    },
    meta: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    name: {
      ...typography.h3,
      color: colors.text,
    },
    status: {
      ...typography.caption,
      color: colors.muted,
    },
    email: {
      ...typography.caption,
      color: colors.soft,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    action: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: colors.cardMuted,
      paddingHorizontal: spacing.sm,
    },
    actionPrimary: {
      backgroundColor: colors.accent,
    },
    actionPressed: {
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
    actionText: {
      ...typography.caption,
      color: colors.text,
      fontWeight: '800',
    },
    actionTextPrimary: {
      color: colors.white,
    },
  });
