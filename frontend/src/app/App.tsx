import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import NotificationHandler from "@/features/notifications/components/NotificationHandler.js";
import { AuthProvider, useAuth } from '@/app/providers/AuthContext.js';
import { WebSocketProvider } from '@/app/providers/WebSocketContext.js';
import { AudioCallProvider } from '@/features/call/AudioCallContext.js';
import { RequireAuth, RequireGuest } from "@/features/auth/components/RequireAuth.js";
import { Seo } from "@/shared/ui/Seo.js";
import { ThemeProvider } from "@/app/themes/ThemeProvider.js";
import { AppDialogProvider } from "@/app/providers/AppDialogProvider.js";
import { PostAuthBootstrapManager } from "@/features/bootstrap/PostAuthBootstrapManager.js";
import { PushPermissionBanner } from "@/features/notifications/components/PushPermissionBanner.js";

const Login = lazy(() => import("@/features/auth/components/Login.js"));
const Register = lazy(() => import("@/features/auth/components/Register.js"));
const Profile = lazy(() => import("@/features/profile/components/Profile.js"));
const ProfileMain = lazy(() => import("@/features/profile/components/ProfileMain.js"));
const ProfileEdit = lazy(() => import("@/features/profile/components/ProfileEdit.js"));
const Wall = lazy(() => import("@/features/wall/components/Wall.js"));
const Conversations = lazy(() => import("@/features/chat/components/Conversations.js"));
const Chat = lazy(() => import("@/features/chat/components/Chat.js"));
const Friends = lazy(() => import("@/features/friends/components/Friends.js"));
const VerifyEmail = lazy(() => import("@/features/auth/components/VerifyEmail.js"));
const PrivacyPolicy = lazy(() => import("@/features/legal/components/PrivacyPolicy.js"));
const AccountDeletion = lazy(() => import("@/features/legal/components/AccountDeletion.js"));

function AppRoutes() {
    const { currentUser } = useAuth();

    return (
        <Suspense fallback={<div className="min-h-screen bg-[var(--app-bg)]" />}>
            <Routes>
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/account-deletion" element={<AccountDeletion />} />
                <Route element={<RequireGuest />}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                </Route>
                <Route path="/verify-email/:token" element={<VerifyEmail />} />
                <Route element={<RequireAuth />}>
                    <Route path="/users/:id" element={<Profile />}>
                        <Route index element={<ProfileMain />} />
                        <Route path="edit" element={<ProfileEdit />} />
                        <Route path="wall" element={<Wall />} />
                        <Route path="conversations" element={<Conversations />} />
                        <Route path="chat/:userId" element={<Chat />} />
                        <Route path="friends" element={<Friends />} />
                    </Route>
                </Route>
                <Route path="/" element={<Navigate to={currentUser ? `/users/${currentUser.id}` : '/login'} />} />
            </Routes>
        </Suspense>
    );
}

function App() {
    return (
        <ThemeProvider>
            <AppDialogProvider>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        style: {
                            background: 'var(--app-card)',
                            border: '1px solid var(--app-border)',
                            color: 'var(--app-text-primary)',
                            boxShadow: 'var(--app-card-shadow)',
                        },
                        success: {
                            iconTheme: {
                                primary: 'var(--app-success)',
                                secondary: 'var(--app-text-inverse)',
                            },
                        },
                        error: {
                            iconTheme: {
                                primary: 'var(--app-error)',
                                secondary: 'var(--app-text-inverse)',
                            },
                        },
                    }}
                />
                <Seo />
                <WebSocketProvider>
                    <AuthProvider>
                        <AudioCallProvider>
                            <PostAuthBootstrapManager />
                            <PushPermissionBanner />
                            <NotificationHandler />
                            <AppRoutes />
                        </AudioCallProvider>
                    </AuthProvider>
                </WebSocketProvider>
            </AppDialogProvider>
        </ThemeProvider>
    );
}

export default App;
