import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLifecycleProvider } from './src/context/AppLifecycleContext';
import { AuthProvider } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { UnreadProvider } from './src/context/UnreadContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, useThemeColors } from './src/theme/ThemeContext';

function AppContent() {
  const colors = useThemeColors();

  return (
    <>
      <StatusBar
        barStyle={colors.statusBarStyle}
        backgroundColor={colors.background}
      />
      <AuthProvider>
        <AppLifecycleProvider>
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
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
