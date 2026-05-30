import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type AppLifecycleContextValue = {
  appState: AppStateStatus;
  isForeground: boolean;
  resumeCount: number;
  networkReady: boolean;
  networkConnected: boolean;
};

const AppLifecycleContext = createContext<AppLifecycleContextValue | undefined>(
  undefined,
);

function isNetworkConnected(state: NetInfoState | null) {
  if (!state) {
    return true;
  }

  return state.isConnected !== false && state.isInternetReachable !== false;
}

export function AppLifecycleProvider({ children }: { children: ReactNode }) {
  const previousAppState = useRef<AppStateStatus>(AppState.currentState);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [resumeCount, setResumeCount] = useState(0);
  const [networkState, setNetworkState] = useState<NetInfoState | null>(null);
  const [networkReady, setNetworkReady] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      const previous = previousAppState.current;
      previousAppState.current = nextAppState;
      setAppState(nextAppState);

      if (nextAppState === 'active' && previous !== 'active') {
        setResumeCount(value => value + 1);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setNetworkState(state);
      setNetworkReady(true);
    });

    return unsubscribe;
  }, []);

  const value = useMemo(
    () => ({
      appState,
      isForeground: appState === 'active',
      resumeCount,
      networkReady,
      networkConnected: isNetworkConnected(networkState),
    }),
    [appState, networkReady, networkState, resumeCount],
  );

  return (
    <AppLifecycleContext.Provider value={value}>
      {children}
    </AppLifecycleContext.Provider>
  );
}

export function useAppLifecycle() {
  const value = useContext(AppLifecycleContext);
  if (!value) {
    throw new Error('useAppLifecycle must be used inside AppLifecycleProvider');
  }
  return value;
}
