import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MailCheck, MailWarning, MessageCircle } from 'lucide-react-native';

import { isEmailVerified } from '../../api/auth';
import type { PostUser } from '../../api/types';
import { Card, HeroCard, ListRow, Section } from '../../components/Layout';
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
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';
import { WallFeed } from './WallFeed';

type HomeNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<MainStackParamList>
>;

export default function HomeScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<HomeNavigation>();
  const { user, refreshUser } = useAuth();
  const { unreadCount, refreshUnreadCount } = useUnread();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const emailVerified = isEmailVerified(user);
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

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    load().catch(() => undefined);
  });

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
    <Screen padded={false} scroll={false} style={styles.screen}>
      <WallFeed
        currentUser={user}
        userId={user?.id}
        isOwner
        emailVerified={emailVerified}
        onOpenUser={openWallUser}
        ListHeaderComponent={
          <>
            <HeroCard
              title={`Привет, ${user?.name || user?.email || 'друг'}`}
            />

            <ErrorBanner message={error} />
            {!emailVerified ? <EmailVerificationNotice /> : null}

            <Section title="Активность" subtitle="То, ради чего пользователь открывает главную">
              <View style={styles.activityCard}>
                <ListRow
                  icon={emailVerified ? MailCheck : MailWarning}
                  title={emailVerified ? 'Аккаунт готов' : 'Подтвердите email'}
                  subtitle={
                    emailVerified
                      ? 'Публикация и общение доступны.'
                      : 'После подтверждения письмо можно будет использовать без ограничений.'
                  }
                  selected={!emailVerified}
                />
              </View>
            </Section>
          </>
        }
      />
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      backgroundColor: colors.background,
    },
    summaryGrid: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    statCard: {
      flex: 1,
      minHeight: 104,
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderRadius: radius.xl,
    },
    statTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    statIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    statValue: {
      ...typography.title,
      color: colors.textPrimary,
    },
    statLabel: {
      ...typography.caption,
      color: colors.muted,
    },
    activityCard: {
      gap: spacing.sm,
    },
  });
