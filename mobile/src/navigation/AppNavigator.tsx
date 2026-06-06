import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { enableScreens } from 'react-native-screens';

import { useAppLifecycle } from '../context/AppLifecycleContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { useUnread } from '../context/UnreadContext';
import {
  flushPendingNotificationNavigation,
  navigationRef,
} from '../notifications/navigation';
import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/main/HomeScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import FriendsScreen from '../screens/main/FriendsScreen';
import ChatListScreen from '../screens/main/ChatListScreen';
import ChatScreen from '../screens/main/ChatScreen';
import NotificationsScreen from '../screens/main/NotificationsScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import UserProfileScreen from '../screens/main/UserProfileScreen';
import UserSearchScreen from '../screens/main/UserSearchScreen';
import type {
  AuthStackParamList,
  ChatStackParamList,
  MainStackParamList,
  MainTabParamList,
} from './types';

enableScreens();

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}
    >
      <AuthStack.Screen
        name="Login"
        component={LoginScreen}
        options={{ title: 'Вход' }}
      />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ title: 'Регистрация' }}
      />
    </AuthStack.Navigator>
  );
}

function ChatNavigator() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <ChatStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}
    >
      <ChatStack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{ title: 'Чаты' }}
      />
      <ChatStack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
    </ChatStack.Navigator>
  );
}

function MainNavigator() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <MainStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}
    >
      <MainStack.Screen
        name="MainTabs"
        component={MainTabsNavigator}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={({ route }) => ({
          title: route.params.name || 'Профиль',
        })}
      />
      <MainStack.Screen
        name="UserSearch"
        component={UserSearchScreen}
        options={{ title: 'Поиск' }}
      />
    </MainStack.Navigator>
  );
}

function MainTabsNavigator() {
  const { unreadCount } = useUnread();
  const { unreadNotificationCount } = useNotifications();
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <MainTabs.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <MainTabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Главная', tabBarLabel: 'Главная' }}
      />
      <MainTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Профиль', tabBarLabel: 'Профиль' }}
      />
      <MainTabs.Screen
        name="Friends"
        component={FriendsScreen}
        options={{ title: 'Друзья', tabBarLabel: 'Друзья' }}
      />
      <MainTabs.Screen
        name="Chats"
        component={ChatNavigator}
        options={{
          headerShown: false,
          tabBarLabel: 'Чаты',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <MainTabs.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: 'Уведомления',
          tabBarLabel: 'Уведомления',
          tabBarBadge:
            unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
        }}
      />
      <MainTabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Настройки', tabBarLabel: 'Еще' }}
      />
    </MainTabs.Navigator>
  );
}

function ConnectionBanner() {
  const { networkConnected, networkReady } = useAppLifecycle();
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (!networkReady || networkConnected) {
    return null;
  }

  return (
    <View style={styles.connectionBanner}>
      <Text style={styles.connectionText}>
        Нет подключения к интернету. Данные обновятся после восстановления сети.
      </Text>
    </View>
  );
}

function LoadingScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.loadingText}>Проверяем сессию</Text>
    </View>
  );
}

export function AppNavigator() {
  const { user, initializing } = useAuth();
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (initializing) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.root}>
      <ConnectionBanner />
      <NavigationContainer
        ref={navigationRef}
        onReady={flushPendingNotificationNavigation}
      >
        {!user ? <AuthNavigator /> : <MainNavigator />}
      </NavigationContainer>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    backgroundColor: colors.background,
  },
  connectionBanner: {
    backgroundColor: colors.warningSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.warning,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  connectionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  header: {
    backgroundColor: colors.background,
  },
  tabBar: {
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 15,
  },
});
