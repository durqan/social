import React, { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  AppLifecycleProvider,
  useAppLifecycle,
} from '../context/AppLifecycleContext';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { CallProvider } from '../context/CallContext';
import { NotificationsProvider } from '../context/NotificationsContext';
import { UnreadProvider } from '../context/UnreadContext';
import { chatSocket } from '../api/ws';
import { runPostAuthBootstrap } from '../bootstrap/postAuthBootstrap';
import { AppNavigator } from '../navigation/AppNavigator';
import {
  flushPendingNotificationNavigation,
  navigationRef,
} from '../notifications/navigation';
import { ThemeProvider, useThemeColors } from '../theme/ThemeContext';
import { logCallEnvOnce } from '../utils/callDiagnostics';

const linking = {
  prefixes: ['social://'],
  config: {
    screens: {
      VerifyEmail: 'verify-email/:token',
      ResetPassword: 'reset-password',
    },
  },
};

function PostAuthBootstrap() {
  const { user } = useAuth();
  const { networkConnected, resumeCount } = useAppLifecycle();

  useEffect(() => {
    if (!user?.id || !networkConnected) {
      return;
    }
    runPostAuthBootstrap(user.id).catch(() => undefined);
  }, [networkConnected, resumeCount, user?.id]);

  return null;
}

function RealtimeConnection() {
  const { user } = useAuth();
  const { appState, networkConnected, networkReady } = useAppLifecycle();

  useEffect(() => {
    chatSocket.setAppState(appState);
  }, [appState]);

  useEffect(() => {
    if (networkReady) {
      chatSocket.setNetworkOnline(networkConnected);
    }
  }, [networkConnected, networkReady]);

  useEffect(() => {
    if (user?.id) {
      chatSocket.connect();
    } else {
      chatSocket.disconnect();
    }

    return () => chatSocket.disconnect();
  }, [user?.id]);

  return null;
}

function AppContent() {
  const colors = useThemeColors();

  useEffect(() => {
    logCallEnvOnce('app_start');
  }, []);

  return (
    <>
      <StatusBar
        barStyle={colors.statusBarStyle}
        backgroundColor={colors.background}
        translucent={true}
      />

      <AuthProvider>
        <AppLifecycleProvider>
          <RealtimeConnection />
          <PostAuthBootstrap />
          <UnreadProvider>
            <NotificationsProvider>
              <CallProvider>
                <AppNavigator />
              </CallProvider>
            </NotificationsProvider>
          </UnreadProvider>
        </AppLifecycleProvider>
      </AuthProvider>
    </>
  );
}

export default function AppRoot() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <NavigationContainer
            ref={navigationRef}
            linking={linking}
            onReady={flushPendingNotificationNavigation}
          >
            <ThemeProvider>
              <AppContent />
            </ThemeProvider>
          </NavigationContainer>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
