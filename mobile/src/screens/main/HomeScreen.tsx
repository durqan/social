import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { messageApi } from '../../api/messages';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner, Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { getApiErrorMessage } from '../../api/http';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import type { MainTabParamList } from '../../navigation/types';

type HomeNavigation = BottomTabNavigationProp<MainTabParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { user, refreshUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [count] = await Promise.all([
        messageApi.getUnreadCount(),
        refreshUser(),
      ]);
      setUnreadCount(count);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  return (
    <Screen
      contentContainerStyle={styles.content}
      scroll
      style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Social mobile</Text>
        <Text style={styles.title}>{user?.name || user?.email}</Text>
        <Text style={styles.subtitle}>
          Мобильный клиент подключен к существующему backend API.
        </Text>
      </View>

      <ErrorBanner message={error} />

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{unreadCount}</Text>
          <Text style={styles.statLabel}>непрочитанных</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {user?.isEmailVerified ? 'Да' : 'Нет'}
          </Text>
          <Text style={styles.statLabel}>email подтвержден</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <AppButton
          title="Открыть чаты"
          onPress={() => navigation.navigate('Chats', { screen: 'ChatList' })}
        />
        <AppButton
          title="Друзья"
          variant="secondary"
          onPress={() => navigation.navigate('Friends')}
        />
      </View>

      <Notice
        title="Лента постов"
        text="Для первого этапа мобильный клиент не переносит весь web frontend. Лента и редактирование профиля оставлены TODO, чтобы не расширять API и не ломать web."
      />

      <RefreshControlView loading={loading} onRefresh={load} />
    </Screen>
  );
}

function RefreshControlView({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
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

const styles = StyleSheet.create({
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
  actions: {
    gap: 10,
  },
  refreshBox: {
    alignItems: 'center',
  },
});
