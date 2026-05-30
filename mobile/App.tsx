import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLifecycleProvider } from './src/context/AppLifecycleContext';
import { AuthProvider } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { UnreadProvider } from './src/context/UnreadContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme/colors';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
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
    </SafeAreaProvider>
  );
}

export default App;
