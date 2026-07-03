import { apiRequest, clearSessionCookies } from './http';
import type { AuthResponse, LoginPayload, RegisterPayload, User } from './types';
import { normalizeUser } from './types';

export const authApi = {
  async login(payload: LoginPayload) {
    const response = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: payload,
    });

    return {
      ...response,
      user: normalizeUser(response.user),
    };
  },

  async register(payload: RegisterPayload) {
    const response = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: payload,
    });

    return {
      ...response,
      user: normalizeUser(response.user),
    };
  },

  async logout() {
    try {
      await apiRequest<{ message: string }>('/auth/logout', {
        method: 'POST',
      });
    } finally {
      await clearSessionCookies();
    }
  },

  async sendVerificationEmail() {
    const response = await apiRequest<{ message: string }>(
      '/auth/send-verification',
      {
        method: 'POST',
      },
    );
    return response.message;
  },

  async verifyEmail(token: string) {
    const response = await apiRequest<{ message: string }>(
      `/auth/verify-email/${token}`,
    );
    return response.message;
  },

  async forgotPassword(email: string) {
    const response = await apiRequest<{ message: string }>(
      '/auth/forgot-password',
      {
        method: 'POST',
        body: { email },
      },
    );
    return response.message;
  },

  async resetPassword(token: string, password: string) {
    const response = await apiRequest<{ message: string }>(
      '/auth/reset-password',
      {
        method: 'POST',
        body: { token, password },
      },
    );
    return response.message;
  },
};

export function isEmailVerified(user: User | null) {
  return Boolean(user?.isEmailVerified ?? user?.is_email_verified);
}
