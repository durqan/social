import api from '../api/axios.js';
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
        const response = await api.post('/auth/login', data);
        return {
            ...response.data,
            user: normalizeUser(response.data.user),
        };
    },

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await api.post('/auth/register', data);
        return {
            ...response.data,
            user: normalizeUser(response.data.user),
        };
    },

    async logout() {
        await api.post('/auth/logout');
    },

    async sendVerificationEmail(): Promise<string> {
        const response = await api.post('/auth/send-verification');
        return response.data.message;
    },

    async verifyEmail(token: string): Promise<string> {
        const response = await api.get(`/auth/verify-email/${token}`);
        return response.data.message;
    },
};
