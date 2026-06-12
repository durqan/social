import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { ActionTile, Card, HeroCard, Section } from '../../components/Layout';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import { ErrorBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { getApiErrorMessage } from '../../api/http';
import { useAuth } from '../../context/AuthContext';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { radius, spacing, typography } from '../../theme/layout';
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
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!emailVerified) {
        await refreshUser();
        return;
      }

      await Promise.all([refreshUnreadCount(), refreshUser()]);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }, [emailVerified, refreshUnreadCount, refreshUser]);

  async function handleManualRefresh() {
    setManualRefreshing(true);
    try {
      await load();
    } finally {
      setManualRefreshing(false);
    }
  }

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
      name: target.name || 'Пользователь',
    });
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll style={styles.screen}>
      <HeroCard
        kicker="Главная"
        title={`Привет, ${user?.name || user?.email || 'друг'}`}
        subtitle="Лента, быстрые действия и статус аккаунта — без лишней каши на экране."
      />

      <ErrorBanner message={error} />
      {!emailVerified ? <EmailVerificationNotice /> : null}

      <Section title="Сводка" subtitle="Самое важное сейчас">
        <View style={styles.grid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{unreadCount}</Text>
            <Text style={styles.statLabel}>непрочитанных сообщений</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{emailVerified ? 'Готов' : 'Ждет'}</Text>
            <Text style={styles.statLabel}>статус email</Text>
          </Card>
        </View>
      </Section>

      <Section title="Быстрый доступ" subtitle="Частые действия в один тап">
        <View style={styles.quickGrid}>
          <ActionTile title="Профиль" text="Данные аккаунта" emoji="☺" onPress={() => navigation.navigate('Profile')} />
          <ActionTile title="Друзья" text="Список и заявки" emoji="◇" onPress={() => navigation.navigate('Friends')} />
          <ActionTile title="Чаты" text="Сообщения" emoji="✉" onPress={() => navigation.navigate('Chats', { screen: 'ChatList' })} />
          <ActionTile title="Настройки" text="Тема и выход" emoji="⚙" onPress={() => navigation.navigate('Settings')} />
        </View>
      </Section>

      <View style={styles.refreshBox}>
        <AppButton
          title="Обновить"
          variant="ghost"
          loading={manualRefreshing}
          onPress={handleManualRefresh}
        />
      </View>

      <Section title="Лента" subtitle="Публикации и активность">
        <WallFeed
          currentUser={user}
          userId={user?.id}
          isOwner
          emailVerified={emailVerified}
          onOpenUser={openWallUser}
        />
      </Section>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      backgroundColor: colors.background,
    },
    content: {
      gap: spacing.xl,
      paddingBottom: 124,
    },
    grid: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    statCard: {
      flex: 1,
      minHeight: 90,
      justifyContent: 'center',
      gap: spacing.xs,
      borderRadius: radius.lg,
    },
    statValue: {
      ...typography.h2,
      color: colors.text,
    },
    statLabel: {
      ...typography.caption,
      color: colors.muted,
    },
    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
    },
    refreshBox: {
      alignItems: 'center',
      marginTop: -spacing.sm,
    },
  });
