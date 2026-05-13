import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios.js';
import type {Conversation} from "../types.js";

function Conversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetchConversations();
    }, []);

    const fetchConversations = async () => {
        try {
            const res = await api.get('/messages/conversations');
            setConversations(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error(err);
            setConversations([]);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-4 text-center">Загрузка...</div>;

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Сообщения</h1>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {!conversations || conversations.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Нет диалогов</div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.user_id}
                            onClick={() => navigate(`/users/${conv.user_id}/chat/${conv.user_id}`)}
                            className="flex items-center gap-3 p-4 hover:bg-gray-50 cursor-pointer transition"
                        >
                            <div className="w-12 h-12 bg-linear-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                                {conv.name?.charAt(0).toUpperCase() || '?'}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between">
                                    <p className="font-semibold">{conv.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {new Date(conv.last_message_at).toLocaleDateString()}
                                    </p>
                                </div>
                                <p className="text-sm text-gray-500 truncate">{conv.last_message}</p>
                            </div>
                            {conv.unread_count > 0 && (
                                <div className="w-5 h-5 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
                                    {conv.unread_count}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default Conversations;