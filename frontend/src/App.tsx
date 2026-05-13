import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Login from './components/Login.js';
import Register from './components/Register.js';
import Profile from './components/Profile.js';
import ProfileMain from "./components/ProfileMain.js";
import ProfileEdit from "./components/ProfileEdit.js";
import Wall from "./components/Wall.js";
import Conversations from "./components/Conversations.js";
import Chat from "./components/Chat.js";
import Friends from "./components/Friends.js";
import { Toaster } from "react-hot-toast";
import NotificationHandler from "./components/NotificationHandler.js";
import api from './api/axios.js';

function App() {
    const [userId, setUserId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/users/profile')
            .then(res => setUserId(res.data.id))
            .catch(() => console.log('Not authorized'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center">Загрузка...</div>;

    return (
        <>
            <Toaster position="top-right" />
            <Router>
                <NotificationHandler />
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/users/:id" element={<Profile />}>
                        <Route index element={<ProfileMain />} />
                        <Route path="edit" element={<ProfileEdit />} />
                        <Route path="wall" element={<Wall />} />
                        <Route path="conversations" element={<Conversations />} />
                        <Route path="chat/:userId" element={<Chat />} />
                        <Route path="friends" element={<Friends />} />
                    </Route>
                    <Route path="/" element={<Navigate to={userId ? `/users/${userId}` : "/login"} />} />
                </Routes>
            </Router>
        </>
    );
}

export default App;