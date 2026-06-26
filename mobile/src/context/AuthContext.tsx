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
import { ApiError, getApiErrorMessage } from '../api/http';
import type { LoginPayload, RegisterPayload, User } from '../api/types';
import { userApi } from '../api/users';
import { chatSocket } from '../api/ws';
import {
  resetPostAuthBootstrap,
  runPostAuthBootstrap,
} from '../bootstrap/postAuthBootstrap';
import { shutdownCurrentCallForLogout } from './callLifecycle';
import { revokeRegisteredPushToken } from '../notifications/pushNotifications';
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

  const refreshUser = useCallback(async () => {
    const profile = await userApi.getProfile();
    setUser(profile);
    if (profile.id) {
      runPostAuthBootstrap(profile.id).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    userApi
      .getProfile()
      .then(profile => {
        if (mounted) {
          setUser(profile);
          if (profile.id) {
            runPostAuthBootstrap(profile.id).catch(() => undefined);
          }
        }
      })
      .catch(error => {
        if (mounted) {
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
        if (mounted) {
          setInitializing(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    setAuthError(null);
    try {
      const response = await authApi.login(payload);
      setUser(response.user);
      if (response.user.id) {
        runPostAuthBootstrap(response.user.id).catch(() => undefined);
      }
    } catch (error) {
      const message = getApiErrorMessage(error);
      setAuthError(message);
      throw error;
    }
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    setAuthError(null);
    try {
      const response = await authApi.register(payload);
      setUser(response.user);
      if (response.user.id) {
        runPostAuthBootstrap(response.user.id).catch(() => undefined);
      }
    } catch (error) {
      const message = getApiErrorMessage(error);
      setAuthError(message);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    if (logoutPromiseRef.current) {
      logDev('[SocialMobile] logout reason', {
        reason: 'logout_already_in_progress',
      });
      return logoutPromiseRef.current;
    }

    logDev('[SocialMobile] logout reason', { reason: 'manual_logout' });
    logoutPromiseRef.current = (async () => {
      await shutdownCurrentCallForLogout().catch(() => undefined);
      chatSocket.disconnect();
      await revokeRegisteredPushToken().catch(() => undefined);
      await resetPostAuthBootstrap();
      try {
        await authApi.logout();
      } catch {
        // Local session state is cleared even if the server is temporarily unavailable.
      }
      setAuthError(null);
      setUser(null);
    })().finally(() => {
      logoutPromiseRef.current = null;
    });

    return logoutPromiseRef.current;
  }, []);

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
