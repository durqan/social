import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { API_BASE_URL, WS_URL } from './src/config/env';
import { AuthProvider } from './src/context/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme/colors';

function App() {
  useEffect(() => {
    console.info(`[SocialMobile] API_BASE_URL=${API_BASE_URL}`);
    console.info(`[SocialMobile] WS_URL=${WS_URL}`);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={colors.background}
      />
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
