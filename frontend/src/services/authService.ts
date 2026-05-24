import { request } from '../api/axios.js';
import type { User } from '../types.js';
import { normalizeUser } from './userService.js';

export interface LoginData {
    email: string;
    password: string;
}

export interface RegisterData {
    name: string;
    email: string;
    password: string;
}

export interface AuthResponse {
    message: string;
    user: User;
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
};
