import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { enableScreens } from 'react-native-screens';

import { isEmailVerified } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import EmailVerificationNoticeScreen from '../screens/auth/EmailVerificationNoticeScreen';
import HomeScreen from '../screens/main/HomeScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import FriendsScreen from '../screens/main/FriendsScreen';
import ChatListScreen from '../screens/main/ChatListScreen';
import ChatScreen from '../screens/main/ChatScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import type {
  AuthStackParamList,
  ChatStackParamList,
  MainTabParamList,
  VerificationStackParamList,
} from './types';

enableScreens();

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const VerificationStack =
  createNativeStackNavigator<VerificationStackParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}>
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

function VerificationNavigator() {
  return (
    <VerificationStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}>
      <VerificationStack.Screen
        name="EmailVerificationNotice"
        component={EmailVerificationNoticeScreen}
        options={{ title: 'Подтверждение email' }}
      />
    </VerificationStack.Navigator>
  );
}

function ChatNavigator() {
  return (
    <ChatStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        contentStyle: styles.content,
      }}>
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
      }}>
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
        options={{ headerShown: false, tabBarLabel: 'Чаты' }}
      />
      <MainTabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Настройки', tabBarLabel: 'Еще' }}
      />
    </MainTabs.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.loadingText}>Проверяем сессию</Text>
    </View>
  );
}

export function AppNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      {!user ? (
        <AuthNavigator />
      ) : !isEmailVerified(user) ? (
        <VerificationNavigator />
      ) : (
        <MainNavigator />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: colors.background,
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
