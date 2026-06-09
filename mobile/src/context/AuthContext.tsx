import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authApi } from '../api/auth';
import { e2eeApi } from '../api/e2ee';
import { getApiErrorMessage } from '../api/http';
import type { LoginPayload, RegisterPayload, User } from '../api/types';
import { userApi } from '../api/users';
import { chatSocket } from '../api/ws';
import { restoreE2EEFromBackup } from '../crypto/keyBackup';
import { getLocalE2EEKeyBundle } from '../crypto/masterKey';
import { revokeRegisteredPushToken } from '../notifications/pushNotifications';
import { warnDev } from '../utils/logger';

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

  const refreshUser = useCallback(async () => {
    const profile = await userApi.getProfile();
    setUser(profile);
  }, []);

  useEffect(() => {
    let mounted = true;

    userApi
      .getProfile()
      .then(profile => {
        if (mounted) {
          setUser(profile);
        }
      })
      .catch(() => {
        if (mounted) {
          setUser(null);
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
        restoreLocalE2EEKey(response.user.id, payload.password).catch(() =>
          undefined,
        );
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
    } catch (error) {
      const message = getApiErrorMessage(error);
      setAuthError(message);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    chatSocket.disconnect();
    await revokeRegisteredPushToken().catch(() => undefined);
    try {
      await authApi.logout();
    } catch {
      // Local session state is cleared even if the server is temporarily unavailable.
    }
    setAuthError(null);
    setUser(null);
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

async function restoreLocalE2EEKey(userId: number, password: string) {
  try {
    if (await getLocalE2EEKeyBundle(userId)) {
      return;
    }

    const backup = await e2eeApi.getBackup();
    if (backup.enabled && backup.encrypted_master_key) {
      await restoreE2EEFromBackup(
        userId,
        password,
        backup.encrypted_master_key,
      );
    }
  } catch (error) {
    warnDev('[SocialMobile] E2EE key restore failed', error);
  }
}
