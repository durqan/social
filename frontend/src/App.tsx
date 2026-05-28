import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login.js';
import Register from './components/Register.js';
import Profile from './components/Profile.js';
import ProfileMain from './components/ProfileMain.js';
import ProfileEdit from './components/ProfileEdit.js';
import Wall from './components/Wall.js';
import Conversations from './components/Conversations.js';
import Chat from './components/Chat.js';
import Friends from './components/Friends.js';
import VerifyEmail from './components/VerifyEmail.js';
import { Toaster } from 'react-hot-toast';
import NotificationHandler from './components/NotificationHandler.js';
import { AuthProvider, useAuth } from './contexts/AuthContext.js';
import { WebSocketProvider } from './contexts/WebSocketContext.js';
import { AudioCallProvider } from './contexts/AudioCallContext.js';
import { RequireAuth, RequireGuest } from './components/RequireAuth.js';
import { PushSubscriptionManager } from './components/notifications/PushSubscriptionManager.js';

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
                <WebSocketProvider>
                    <AuthProvider>
                        <AudioCallProvider>
                            <PushSubscriptionManager />
                            <NotificationHandler />
                            <AppRoutes />
                        </AudioCallProvider>
                    </AuthProvider>
                </WebSocketProvider>
            </Router>
        </>
    );
}

export default App;
