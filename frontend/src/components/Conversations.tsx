import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from '../types.js';
import { messageService } from '../services/messageService.js';
import { Avatar } from './ui/Avatar.js';
import { useAuth } from '../contexts/AuthContext.js';
import { formatMonthDayDate } from '../utils/date.js';

function Conversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const { currentUser } = useAuth();

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

    if (loading) {
        return <div className="p-4 text-center">Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 sm:mb-4 sm:text-2xl">Сообщения</h1>
            <div className="app-card overflow-hidden">
                {!conversations || conversations.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 sm:p-8">Нет диалогов</div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.user_id}
                            onClick={() => currentUser?.id && navigate(`/users/${currentUser.id}/chat/${conv.user_id}`)}
                            className="flex items-center gap-3 border-b border-gray-100 p-3 transition last:border-b-0 hover:bg-gray-50 sm:p-4"
                        >
                            <Avatar name={conv.name} size="lg" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="truncate font-semibold text-gray-950">{conv.name}</p>
                                    <p className="flex-shrink-0 text-xs text-gray-500">
                                        {formatMonthDayDate(conv.last_message_at)}
                                    </p>
                                </div>
                                <p className="truncate text-sm text-gray-500">{conv.last_message}</p>
                            </div>
                            {conv.unread_count > 0 && (
                                <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-xs text-white">
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
