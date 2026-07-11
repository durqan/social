import React from 'react';
import {
  useNavigation,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { isEmailVerified } from '../../api/auth';
import type { PostUser } from '@social/shared';
import { HeroCard } from '../../components/Layout';
import { EmailVerificationNotice } from '../../components/EmailVerificationNotice';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
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
  const { user } = useAuth();
  const emailVerified = isEmailVerified(user);

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
    <Screen padded={false} scroll={false}>
      <WallFeed
        currentUser={user}
        userId={user?.id}
        isOwner
        emailVerified={emailVerified}
        onOpenUser={openWallUser}
        ListHeaderComponent={
          <>
            <HeroCard
              kicker="Ваша лента"
              title={`Что нового, ${user?.name || user?.email || 'друг'}?`}
              subtitle="Поделитесь обновлением или посмотрите последние публикации."
            />

            {!emailVerified ? <EmailVerificationNotice /> : null}
          </>
        }
      />
    </Screen>
  );
}
