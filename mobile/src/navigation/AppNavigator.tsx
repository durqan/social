import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  getFocusedRouteNameFromRoute,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type {
  NativeStackNavigationOptions,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { enableScreens } from 'react-native-screens';
import {
  Bell,
  ChevronLeft,
  Home,
  Menu,
  MessageCircle,
  Phone,
  UserRound,
  UsersRound,
  Video,
} from 'lucide-react-native';

import { useAppLifecycle } from '../context/AppLifecycleContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { useUnread } from '../context/UnreadContext';
import { useCall } from '../context/CallContext';
import { IconButton } from '../components/IconButton';
import {
  flushPendingNotificationNavigation,
  navigationRef,
} from '../notifications/navigation';
import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { elevation, radius, spacing, typography } from '../theme/layout';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
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
const linking = {
  prefixes: ['social://'],
  config: {
    screens: {
      Login: 'login',
      Register: 'register',
      VerifyEmail: 'verify-email/:token',
      MainTabs: '',
      UserProfile: 'users/:userId',
      UserSearch: 'users/search',
    },
  },
};

function AuthNavigator() {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        headerTitleStyle: styles.headerTitle,
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
      <AuthStack.Screen
        name="VerifyEmail"
        component={VerifyEmailScreen}
        options={{ title: 'Подтверждение email' }}
      />
    </AuthStack.Navigator>
  );
}


function ChatHeaderActions({
  userId,
  name,
}: {
  userId: number;
  name?: string;
}) {
  const { status, startAudioCall, startVideoCall } = useCall();
  const disabled = status !== 'idle';

  return (
    <View style={stylesStatic.chatHeaderActions}>
      <IconButton
        icon={Phone}
        label="Аудиозвонок"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onPress={() => startAudioCall(userId, name)}
        style={stylesStatic.chatHeaderButton}
      />
      <IconButton
        icon={Video}
        label="Видеозвонок"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onPress={() => startVideoCall(userId, name)}
        style={stylesStatic.chatHeaderButton}
      />
    </View>
  );
}

type ChatScreenOptionsArgs = {
  route: NativeStackScreenProps<ChatStackParamList, 'Chat'>['route'];
  navigation: NativeStackScreenProps<ChatStackParamList, 'Chat'>['navigation'];
};

function chatScreenOptions({
  route,
  navigation,
}: ChatScreenOptionsArgs): NativeStackNavigationOptions {
  return {
    title: route.params.name,
    headerBackVisible: false,
    headerLeft: () => (
      <IconButton
        icon={ChevronLeft}
        label="Назад к списку чатов"
        variant="ghost"
        size="sm"
        onPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
            return;
          }
          navigation.navigate('ChatList');
        }}
        style={stylesStatic.chatHeaderBackButton}
      />
    ),
    headerRight: () => (
      <ChatHeaderActions
        userId={route.params.userId}
        name={route.params.name}
      />
    ),
  };
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
        headerTitleStyle: styles.headerTitle,
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
        options={chatScreenOptions}
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
        headerTitleStyle: styles.headerTitle,
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
      <MainStack.Screen
        name="VerifyEmail"
        component={VerifyEmailScreen}
        options={{ title: 'Подтверждение email' }}
      />
    </MainStack.Navigator>
  );
}

type TabIconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

function TabIcon({
  Icon,
  color,
  focused,
}: {
  Icon: TabIconComponent;
  color: string;
  focused: boolean;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const iconColor = focused ? colors.white : color;

  return (
    <View
      style={[
        stylesStatic.tabIconShell,
        focused && styles.tabIconShellActive,
      ]}
    >
      <Icon color={iconColor} size={20} strokeWidth={focused ? 2.7 : 2.2} />
    </View>
  );
}

function HomeTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return <TabIcon color={color} focused={focused} Icon={Home} />;
}

function ProfileTabIcon({
  color,
  focused,
}: {
  color: string;
  focused: boolean;
}) {
  return <TabIcon color={color} focused={focused} Icon={UserRound} />;
}

function FriendsTabIcon({
  color,
  focused,
}: {
  color: string;
  focused: boolean;
}) {
  return <TabIcon color={color} focused={focused} Icon={UsersRound} />;
}

function ChatsTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return <TabIcon color={color} focused={focused} Icon={MessageCircle} />;
}

function NotificationsTabIcon({
  color,
  focused,
}: {
  color: string;
  focused: boolean;
}) {
  return <TabIcon color={color} focused={focused} Icon={Bell} />;
}

function SettingsTabIcon({
  color,
  focused,
}: {
  color: string;
  focused: boolean;
}) {
  return <TabIcon color={color} focused={focused} Icon={Menu} />;
}

function MainTabsNavigator() {
  const { unreadCount } = useUnread();
  const { unreadNotificationCount } = useNotifications();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  const tabBarStyle = [
    styles.tabBar,
    {
      height: 66 + insets.bottom,
      paddingBottom: Math.max(insets.bottom, 9),
    },
  ];
  const hiddenTabBarStyle = { display: 'none' as const };

  return (
    <MainTabs.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: styles.header,
        headerTintColor: colors.text,
        headerTitleStyle: styles.headerTitle,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarBadgeStyle: styles.tabBarBadge,
      }}
    >
      <MainTabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Главная',
          tabBarLabel: 'Главная',
          tabBarIcon: HomeTabIcon,
        }}
      />
      <MainTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Профиль',
          tabBarLabel: 'Профиль',
          tabBarIcon: ProfileTabIcon,
        }}
      />
      <MainTabs.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          title: 'Друзья',
          tabBarLabel: 'Друзья',
          tabBarIcon: FriendsTabIcon,
        }}
      />
      <MainTabs.Screen
        name="Chats"
        component={ChatNavigator}
        options={({ route }) => {
          const routeName = getFocusedRouteNameFromRoute(route) ?? 'ChatList';

          return {
            headerShown: false,
            tabBarLabel: 'Чаты',
            tabBarIcon: ChatsTabIcon,
            tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
            tabBarStyle: routeName === 'Chat' ? hiddenTabBarStyle : tabBarStyle,
          };
        }}
      />
      <MainTabs.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: 'Уведомления',
          tabBarLabel: 'Увед.',
          tabBarIcon: NotificationsTabIcon,
          tabBarBadge:
            unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
        }}
      />
      <MainTabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Настройки',
          tabBarLabel: 'Еще',
          tabBarIcon: SettingsTabIcon,
        }}
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
        linking={linking}
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
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    connectionText: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    header: {
      backgroundColor: colors.surface,
      borderBottomWidth: 0,
      shadowOpacity: 0,
      elevation: 0,
    },
    headerTitle: {
      ...typography.h3,
      color: colors.text,
      fontWeight: '800',
    },
    tabBar: {
      position: 'absolute',
      left: 14,
      right: 14,
      bottom: 8,
      borderTopWidth: 0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 30,
      backgroundColor: colors.surface,
      paddingTop: 7,
      shadowColor: colors.shadow,
      ...(colors.isDark ? elevation.none : elevation.bar),
    },
    tabBarItem: {
      minWidth: 0,
      paddingHorizontal: 0,
    },
    tabBarIcon: {
      marginTop: 0,
    },
    tabBarLabel: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '900',
      marginTop: 3,
    },
    tabBarBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.danger,
      color: colors.white,
      fontSize: 10,
      fontWeight: '900',
    },
    tabIconShellActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      shadowColor: colors.accent,
      shadowOpacity: colors.isDark ? 0 : 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: colors.isDark ? 0 : 3,
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

const stylesStatic = StyleSheet.create({
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatHeaderBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 0,
    marginLeft: -8,
  },
  chatHeaderButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  tabIconShell: {
    width: 38,
    height: 32,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
