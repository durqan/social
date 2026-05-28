import { request } from "@/shared/api/axios.js";
import { authTokenStore } from "@/shared/api/authToken.js";
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
    token: string;
    user: User;
}

export const authService = {
    async login(data: LoginData): Promise<AuthResponse> {
        const response = await request.post<AuthResponse>('/auth/login', data);
        authTokenStore.set(response.token);
        return {
            ...response,
            user: normalizeUser(response.user),
        };
    },

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await request.post<AuthResponse>('/auth/register', data);
        authTokenStore.set(response.token);
        return {
            ...response,
            user: normalizeUser(response.user),
        };
    },

    async logout() {
        try {
            await request.post('/auth/logout');
        } finally {
            authTokenStore.clear();
        }
    },

    async sendVerificationEmail(): Promise<string> {
        return (await request.post<{ message: string }>('/auth/send-verification')).message;
    },

    async verifyEmail(token: string): Promise<string> {
        return (await request.get<{ message: string }>(`/auth/verify-email/${token}`)).message;
    },
};
