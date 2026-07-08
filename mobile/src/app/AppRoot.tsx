import React, { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLifecycleProvider } from '../context/AppLifecycleContext';
import { AuthProvider } from '../context/AuthContext';
import { CallProvider } from '../context/CallContext';
import { NotificationsProvider } from '../context/NotificationsContext';
import { UnreadProvider } from '../context/UnreadContext';
import { PostAuthBootstrapManager } from '../components/PostAuthBootstrapManager';
import { AppNavigator } from '../navigation/AppNavigator';
import {
  flushPendingNotificationNavigation,
  navigationRef,
} from '../notifications/navigation';
import { ThemeProvider, useThemeColors } from '../theme/ThemeContext';
import { logCallEnvOnce } from '../utils/callDiagnostics';

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
          <PostAuthBootstrapManager />
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
