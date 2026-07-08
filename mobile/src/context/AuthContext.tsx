import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { authApi } from '../api/auth';
import {
  ApiError,
  clearSessionCookies,
  getApiErrorMessage,
  onAuthInvalid,
} from '../api/http';
import type { LoginPayload, RegisterPayload, User } from '../api/types';
import { userApi } from '../api/users';
import { chatSocket } from '../api/ws';
import {
  ensureE2EEReady,
  resetPostAuthBootstrap,
  runPostAuthBootstrap,
} from '../bootstrap/postAuthBootstrap';
import { shutdownCurrentCallForLogout } from './callLifecycle';
import { revokeRegisteredPushToken } from '../notifications/pushNotifications';
import { clearActivePushConversation } from '../notifications/activeConversation';
import { clearPendingIncomingCall } from '../notifications/pendingIncomingCall';
import { clearPendingOpenedLocalNotifications } from '../notifications/localNotifications';
import { clearPendingNotificationNavigation } from '../notifications/navigation';
import { clearPendingPushEvents } from '../notifications/pushEffects';
import { clearE2EEMessageDisplayCache } from '../features/chat/lib/e2eeMessageTransform';
import { logDev, warnDev } from '../utils/logger';

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  authError: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  sendVerificationEmail: () => Promise<string>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const logoutPromiseRef = useRef<Promise<void> | null>(null);
  const sessionVersionRef = useRef(0);

  const isCurrentSession = useCallback((version: number) => {
    return sessionVersionRef.current === version;
  }, []);

  const cleanupLocalSession = useCallback(
    async ({
      reason,
      logoutFromServer,
    }: {
      reason: string;
      logoutFromServer: boolean;
    }) => {
      sessionVersionRef.current += 1;
      logDev('[SocialMobile] logout reason', { reason });

      await shutdownCurrentCallForLogout().catch(() => undefined);
      chatSocket.disconnect();
      clearE2EEMessageDisplayCache();
      clearActivePushConversation();
      clearPendingNotificationNavigation();

      await revokeRegisteredPushToken().catch(() => undefined);
      await resetPostAuthBootstrap();

      if (logoutFromServer) {
        try {
          await authApi.logout();
        } catch {
          await clearSessionCookies().catch(() => undefined);
        }
      } else {
        await clearSessionCookies().catch(() => undefined);
      }

      await Promise.allSettled([
        clearPendingPushEvents(),
        clearPendingIncomingCall(),
        clearPendingOpenedLocalNotifications(),
      ]);

      setAuthError(null);
      setUser(null);
      setInitializing(false);
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const version = sessionVersionRef.current;
    const profile = await userApi.getProfile();
    if (!isCurrentSession(version)) {
      return;
    }
    setUser(profile);
    if (profile.id) {
      runPostAuthBootstrap(profile.id).catch(() => undefined);
    }
  }, [isCurrentSession]);

  useEffect(() => {
    let mounted = true;

    const version = sessionVersionRef.current;

    userApi
      .getProfile()
      .then(profile => {
        if (mounted && isCurrentSession(version)) {
          setUser(profile);
          if (profile.id) {
            runPostAuthBootstrap(profile.id).catch(() => undefined);
          }
        }
      })
      .catch(error => {
        if (mounted && isCurrentSession(version)) {
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403)
          ) {
            logDev('[SocialMobile] logout reason', {
              reason: 'bootstrap_profile_auth_invalid',
              status: error.status,
            });
            setUser(null);
          } else {
            warnDev(
              '[SocialMobile] profile bootstrap failed without logout',
              error,
            );
          }
        }
      })
      .finally(() => {
        if (mounted && isCurrentSession(version)) {
          setInitializing(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isCurrentSession]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      sessionVersionRef.current += 1;
      const version = sessionVersionRef.current;
      clearE2EEMessageDisplayCache();
      setAuthError(null);
      try {
        const response = await authApi.login(payload);
        if (!isCurrentSession(version)) {
          return;
        }
        setUser(response.user);
        if (response.user.id) {
          await ensureE2EEReady(response.user.id, payload.password);
          runPostAuthBootstrap(response.user.id).catch(() => undefined);
        }
      } catch (error) {
        const message = getApiErrorMessage(error);
        setAuthError(message);
        throw error;
      }
    },
    [isCurrentSession],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      sessionVersionRef.current += 1;
      const version = sessionVersionRef.current;
      clearE2EEMessageDisplayCache();
      setAuthError(null);
      try {
        const response = await authApi.register(payload);
        if (!isCurrentSession(version)) {
          return;
        }
        setUser(response.user);
        if (response.user.id) {
          await ensureE2EEReady(response.user.id, payload.password);
          runPostAuthBootstrap(response.user.id).catch(() => undefined);
        }
      } catch (error) {
        const message = getApiErrorMessage(error);
        setAuthError(message);
        throw error;
      }
    },
    [isCurrentSession],
  );

  useEffect(() => {
    return onAuthInvalid(() => {
      if (logoutPromiseRef.current) {
        return;
      }

      logoutPromiseRef.current = cleanupLocalSession({
        reason: 'auth_invalid',
        logoutFromServer: false,
      }).finally(() => {
        logoutPromiseRef.current = null;
      });
    });
  }, [cleanupLocalSession]);

  const logout = useCallback(async () => {
    if (logoutPromiseRef.current) {
      logDev('[SocialMobile] logout reason', {
        reason: 'logout_already_in_progress',
      });
      return logoutPromiseRef.current;
    }

    logoutPromiseRef.current = cleanupLocalSession({
      reason: 'manual_logout',
      logoutFromServer: true,
    }).finally(() => {
      logoutPromiseRef.current = null;
    });

    return logoutPromiseRef.current;
  }, [cleanupLocalSession]);

  const sendVerificationEmail = useCallback(() => {
    setAuthError(null);
    return authApi.sendVerificationEmail();
  }, []);

  const value = useMemo(
    () => ({
      user,
      initializing,
      authError,
      login,
      register,
      logout,
      refreshUser,
      sendVerificationEmail,
      clearAuthError: () => setAuthError(null),
    }),
    [
      user,
      initializing,
      authError,
      login,
      register,
      logout,
      refreshUser,
      sendVerificationEmail,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
