import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authService, type LoginData, type RegisterData } from "@/features/auth/api/authService.js";
import { userService } from "@/shared/api/userService.js";
import type { User } from "@/shared/types/domain.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";

type AuthContextValue = {
    currentUser: User | null;
    loading: boolean;
    refreshCurrentUser: () => Promise<User | null>;
    login: (data: LoginData) => Promise<User>;
    register: (data: RegisterData) => Promise<User>;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const wsService = useWebSocket();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshCurrentUser = useCallback(async () => {
        try {
            const user = await userService.getProfile();
            setCurrentUser(user);
            wsService.connect();
            return user;
        } catch {
            wsService.disconnect();
            setCurrentUser(null);
            return null;
        }
    }, [wsService]);

    useEffect(() => {
        refreshCurrentUser().finally(() => setLoading(false));
    }, [refreshCurrentUser]);

    const login = useCallback(async (data: LoginData) => {
        const response = await authService.login(data);
        setCurrentUser(response.user);
        wsService.connect();
        return response.user;
    }, [wsService]);

    const register = useCallback(async (data: RegisterData) => {
        const response = await authService.register(data);
        setCurrentUser(response.user);
        wsService.connect();
        return response.user;
    }, [wsService]);

    const logout = useCallback(async () => {
        try {
            await authService.logout();
        } finally {
            wsService.disconnect();
            setCurrentUser(null);
        }
    }, [wsService]);

    const value = useMemo(() => ({
        currentUser,
        loading,
        refreshCurrentUser,
        login,
        register,
        logout,
    }), [currentUser, loading, refreshCurrentUser, login, register, logout]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};
