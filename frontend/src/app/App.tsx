import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from "@/features/auth/components/Login.js";
import Register from "@/features/auth/components/Register.js";
import Profile from "@/features/profile/components/Profile.js";
import ProfileMain from "@/features/profile/components/ProfileMain.js";
import ProfileEdit from "@/features/profile/components/ProfileEdit.js";
import Wall from "@/features/wall/components/Wall.js";
import Conversations from "@/features/chat/components/Conversations.js";
import Chat from "@/features/chat/components/Chat.js";
import Friends from "@/features/friends/components/Friends.js";
import Watcher from "@/features/watcher/components/Watcher.js";
import VerifyEmail from "@/features/auth/components/VerifyEmail.js";
import { Toaster } from 'react-hot-toast';
import NotificationHandler from "@/features/notifications/components/NotificationHandler.js";
import { AuthProvider, useAuth } from '@/app/providers/AuthContext.js';
import { WebSocketProvider } from '@/app/providers/WebSocketContext.js';
import { AudioCallProvider } from '@/features/call/AudioCallContext.js';
import { RequireAuth, RequireGuest } from "@/features/auth/components/RequireAuth.js";
import { PushSubscriptionManager } from "@/features/notifications/components/PushSubscriptionManager.js";
import { Seo } from "@/shared/ui/Seo.js";
import { PetCompanion } from "@/features/pet/components/PetCompanion.js";

function AppRoutes() {
    const { currentUser } = useAuth();

    return (
        <Routes>
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
                    <Route path="watch" element={<Watcher />} />
                </Route>
            </Route>
            <Route path="/" element={<Navigate to={currentUser ? `/users/${currentUser.id}` : '/login'} />} />
        </Routes>
    );
}

function App() {
    return (
        <>
            <Toaster position="top-right" />
            <Router>
                <Seo />
                <WebSocketProvider>
                    <AuthProvider>
                        <AudioCallProvider>
                            <PushSubscriptionManager />
                            <NotificationHandler />
                            <AppRoutes />
                            <PetCompanion />
                        </AudioCallProvider>
                    </AuthProvider>
                </WebSocketProvider>
            </Router>
        </>
    );
}

export default App;
