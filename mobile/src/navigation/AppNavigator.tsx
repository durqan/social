import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
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
  ChevronLeft,
  Home,
  MessageCircle,
  Phone,
  Settings,
  UserRound,
  UsersRound,
  Video,
} from 'lucide-react-native';

import { useAppLifecycle } from '../context/AppLifecycleContext';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import { useCall } from '../context/CallContext';
import { IconButton } from '../components/IconButton';
import { callLog } from '../utils/callDiagnostics';
import { useThemeColors } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/themes';
import { radius, spacing, typography } from '../theme/layout';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import HomeScreen from '../screens/main/HomeScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import FriendsScreen from '../screens/main/FriendsScreen';
import ChatListScreen from '../screens/main/ChatListScreen';
import ChatScreen from '../screens/main/ChatScreen';
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
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ title: 'Восстановление пароля' }}
      />
      <AuthStack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Новый пароль' }}
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
  const normalizedUserId = Number(userId);
  const hasValidUserId =
    Number.isFinite(normalizedUserId) && normalizedUserId > 0;
  const disabled = status !== 'idle' || !hasValidUserId;

  return (
    <View style={stylesStatic.chatHeaderActions}>
      <IconButton
        icon={Phone}
        label="Аудиозвонок"
        variant="ghost"
        size="lg"
        disabled={disabled}
        onPress={() => {
          callLog('CALL_UI', 'audio call button pressed', {
            userId: normalizedUserId,
            hasValidUserId,
            callStatus: status,
          });
          startAudioCall(normalizedUserId, name);
        }}
        style={stylesStatic.chatHeaderButton}
      />
      <IconButton
        icon={Video}
        label="Видеозвонок"
        variant="ghost"
        size="lg"
        disabled={disabled}
        onPress={() => {
          callLog('CALL_UI', 'video call button pressed', {
            userId: normalizedUserId,
            hasValidUserId,
            callStatus: status,
          });
          startVideoCall(normalizedUserId, name);
        }}
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
      <MainStack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Новый пароль' }}
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

function SettingsTabIcon({
  color,
  focused,
}: {
  color: string;
  focused: boolean;
}) {
  return <TabIcon color={color} focused={focused} Icon={Settings} />;
}

function MainTabsNavigator() {
  const { unreadCount } = useUnread();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const styles = createStyles(colors);
  const boundedFontScale = Math.min(Math.max(fontScale, 1), 2);
  const tabBarBaseHeight = 72 + Math.round((boundedFontScale - 1) * 14);
  const useCompactTabLabels = fontScale > 1.05;

  const tabBarStyle = [
    styles.tabBar,
    {
      height: tabBarBaseHeight + insets.bottom,
      paddingBottom: Math.max(insets.bottom, spacing.sm),
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
        tabBarActiveTintColor: colors.accentStrong,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarBadgeStyle: styles.tabBarBadge,
        tabBarAllowFontScaling: true,
      }}
    >
      <MainTabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Главная',
          tabBarLabel: useCompactTabLabels ? 'Домой' : 'Главная',
          tabBarAccessibilityLabel: 'Главная',
          tabBarIcon: HomeTabIcon,
        }}
      />
      <MainTabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Профиль',
          tabBarLabel: useCompactTabLabels ? 'Я' : 'Профиль',
          tabBarAccessibilityLabel: 'Профиль',
          tabBarIcon: ProfileTabIcon,
        }}
      />
      <MainTabs.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          title: 'Друзья',
          tabBarLabel: useCompactTabLabels ? 'Люди' : 'Друзья',
          tabBarAccessibilityLabel: 'Друзья',
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
            tabBarAccessibilityLabel: 'Чаты',
            tabBarIcon: ChatsTabIcon,
            tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
            tabBarStyle: routeName === 'Chat' ? hiddenTabBarStyle : tabBarStyle,
          };
        }}
      />
      <MainTabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Настройки',
          tabBarLabel: useCompactTabLabels ? 'Ещё' : 'Настройки',
          tabBarAccessibilityLabel: 'Настройки',
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
      {!user ? <AuthNavigator /> : <MainNavigator />}
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
      backgroundColor: colors.background,
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
      left: 12,
      right: 12,
      bottom: 8,
      borderTopWidth: 0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 28,
      backgroundColor: colors.surface,
      paddingTop: 6,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0.24 : 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -6 },
      elevation: 6,
    },
    tabBarItem: {
      minWidth: 0,
      minHeight: 52,
      paddingHorizontal: 0,
    },
    tabBarIcon: {
      marginTop: 0,
    },
    tabBarLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '700',
      marginTop: 2,
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
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
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
    gap: 6,
  },
  chatHeaderBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 0,
    marginLeft: -8,
  },
  chatHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  tabIconShell: {
    width: 36,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
