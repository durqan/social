import { request } from "@/shared/api/axios.js";
import type { User } from "@/shared/types/domain.js";
import { normalizeUser } from "@/shared/api/userService.js";

export interface LoginData {
    email: string;
    password: string;
}

export interface RegisterData {
    name: string;
    email: string;
    password: string;
    website?: string;
}

export interface AuthResponse {
    message: string;
    user: User;
}

export interface ForgotPasswordData {
    email: string;
}

export interface ResetPasswordData {
    token: string;
    password: string;
}

export const authService = {
    async login(data: LoginData): Promise<AuthResponse> {
        const response = await request.post<AuthResponse>('/auth/login', data);
        return {
            ...response,
            user: normalizeUser(response.user),
        };
    },

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await request.post<AuthResponse>('/auth/register', data);
        return {
            ...response,
            user: normalizeUser(response.user),
        };
    },

    async logout() {
        await request.post('/auth/logout');
    },

    async sendVerificationEmail(): Promise<string> {
        return (await request.post<{ message: string }>('/auth/send-verification')).message;
    },

    async verifyEmail(token: string): Promise<string> {
        return (await request.get<{ message: string }>(`/auth/verify-email/${token}`)).message;
    },

    async forgotPassword(data: ForgotPasswordData): Promise<string> {
        return (await request.post<{ message: string }>('/auth/forgot-password', data)).message;
    },

    async resetPassword(data: ResetPasswordData): Promise<string> {
        return (await request.post<{ message: string }>('/auth/reset-password', data)).message;
    },
};
