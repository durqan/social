import api from '../api/axios.js';
import type { User } from '../types.js';

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
        return response.data;
    },

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await api.post('/auth/register', data);
        return response.data;
    },

    async logout() {
        await api.post('/auth/logout');
    },
};
