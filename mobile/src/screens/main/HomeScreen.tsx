import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { isEmailVerified } from '../../api/auth';
import type { PostUser } from '../../api/types';
import { AppButton } from '../../components/AppButton';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import { ErrorBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { getApiErrorMessage } from '../../api/http';
import { useAuth } from '../../context/AuthContext';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import type {
  MainStackParamList,
  MainTabParamList,
} from '../../navigation/types';
import { WallFeed } from './WallFeed';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<MainStackParamList>
>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { user, refreshUser } = useAuth();
  const { unreadCount, refreshUnreadCount } = useUnread();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const emailVerified = isEmailVerified(user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!emailVerified) {
        await refreshUser();
        return;
      }

      await Promise.all([refreshUnreadCount(), refreshUser()]);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, [emailVerified, refreshUnreadCount, refreshUser]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  function openWallUser(target: PostUser) {
    if (!target.id || target.id === user?.id) {
      navigation.navigate('Profile');
      return;
    }

    navigation.navigate('UserProfile', {
      userId: target.id,
      name: target.name || target.email,
    });
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Главная</Text>
        <Text style={styles.title}>
          Здравствуйте, {user?.name || user?.email}
        </Text>
        <Text style={styles.subtitle}>
          Быстрый доступ к профилю, друзьям и сообщениям.
        </Text>
      </View>

      <ErrorBanner message={error} />

      {!emailVerified ? <EmailVerificationNotice /> : null}

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{unreadCount}</Text>
          <Text style={styles.statLabel}>непрочитанных сообщений</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {emailVerified ? 'Готов' : 'Ждет'}
          </Text>
          <Text style={styles.statLabel}>статус email</Text>
        </View>
      </View>

      <View style={styles.quickGrid}>
        <QuickAction
          title="Профиль"
          text="Данные аккаунта"
          colors={colors}
          onPress={() => navigation.navigate('Profile')}
        />
        <QuickAction
          title="Друзья"
          text="Список и заявки"
          colors={colors}
          onPress={() => navigation.navigate('Friends')}
        />
        <QuickAction
          title="Чаты"
          text="Сообщения"
          colors={colors}
          onPress={() => navigation.navigate('Chats', { screen: 'ChatList' })}
        />
        <QuickAction
          title="Настройки"
          text="Аккаунт и выход"
          colors={colors}
          onPress={() => navigation.navigate('Settings')}
        />
      </View>

      <RefreshControlView
        loading={loading}
        onRefresh={load}
        colors={colors}
      />

      <WallFeed
        currentUser={user}
        userId={user?.id}
        isOwner
        emailVerified={emailVerified}
        onOpenUser={openWallUser}
      />
    </Screen>
  );
}

function QuickAction({
  title,
  text,
  onPress,
  colors,
}: {
  title: string;
  text: string;
  onPress: () => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.quickAction,
        pressed && styles.quickActionPressed,
      ]}
      onPress={onPress}
    >
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickText}>{text}</Text>
    </Pressable>
  );
}

function RefreshControlView({
  loading,
  onRefresh,
  colors,
}: {
  loading: boolean;
  onRefresh: () => Promise<void>;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.refreshBox}>
      <AppButton
        title="Обновить"
        variant="ghost"
        loading={loading}
        onPress={onRefresh}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
  },
  content: {
    gap: 16,
  },
  hero: {
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 8,
  },
  kicker: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 4,
  },
  statValue: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickAction: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    justifyContent: 'space-between',
  },
  quickActionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  quickTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  quickText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  refreshBox: {
    alignItems: 'center',
  },
});
