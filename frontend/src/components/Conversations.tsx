import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {Conversation} from "../types.js";
import { messageService } from '../services/messageService.js';
import { Avatar } from './ui/Avatar.js';

function Conversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetchConversations();
    }, []);

    const fetchConversations = async () => {
        try {
            setConversations(await messageService.getConversations());
        } catch (err) {
            console.error(err);
            setConversations([]);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-4 text-center">Загрузка...</div>;

    return (
        <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-xl font-bold sm:mb-4 sm:text-2xl">Сообщения</h1>
            <div className="overflow-hidden rounded-lg bg-white shadow-sm sm:rounded-xl">
                {!conversations || conversations.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 sm:p-8">Нет диалогов</div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.user_id}
                            onClick={() => navigate(`/users/${conv.user_id}/chat/${conv.user_id}`)}
                            className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition sm:p-4"
                        >
                            <Avatar name={conv.name} size="lg" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="truncate font-semibold">{conv.name}</p>
                                    <p className="flex-shrink-0 text-xs text-gray-500">
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
