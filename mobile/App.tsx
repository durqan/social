import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AppLifecycleProvider } from './src/context/AppLifecycleContext';
import { PostAuthBootstrapManager } from './src/components/PostAuthBootstrapManager';
import { AuthProvider } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { UnreadProvider } from './src/context/UnreadContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, useThemeColors } from './src/theme/ThemeContext';
import { logCallEnvOnce } from './src/utils/callDiagnostics';

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

function App() {
    return (
        <SafeAreaProvider>
            <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
                <ThemeProvider>
                    <AppContent />
                </ThemeProvider>
            </KeyboardProvider>
        </SafeAreaProvider>
    );
}

export default App;
