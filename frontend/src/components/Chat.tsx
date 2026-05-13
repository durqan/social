import {useEffect, useRef, useState} from 'react';
import {useOutletContext, useParams} from 'react-router-dom';
import api from '../api/axios.js';
import {wsService} from '../services/ws.js';
import type {Message, User} from '../types.js';

function Chat() {
    const {userId} = useParams();
    const {currentUser} = useOutletContext<{ currentUser: User }>();
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [recipient, setRecipient] = useState<User | null>(null);
    const [otherTyping, setOtherTyping] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
    const [editContent, setEditContent] = useState('');
    const [showMenuFor, setShowMenuFor] = useState<number | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstLoad = useRef(true);

    const handleTouchStart = (msgId: number) => {
        longPressTimer.current = setTimeout(() => {
            if (!selectionMode) {
                setSelectionMode(true);
                setSelectedMessages(new Set([msgId]));
            } else {
                toggleSelectMessage(msgId);
            }
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const toggleSelectMessage = (msgId: number) => {
        setSelectedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(msgId)) {
                newSet.delete(msgId);
                if (newSet.size === 0) setSelectionMode(false);
            } else {
                newSet.add(msgId);
            }
            return newSet;
        });
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedMessages(new Set());
        setDeleteConfirmOpen(false);
    };

    const handleBatchDelete = async () => {
        if (selectedMessages.size === 0) return;

        const realIds = Array.from(selectedMessages).filter(id => id > 0 && id < 10000000);
        if (realIds.length === 0) {
            alert('Нельзя удалить ещё не отправленные сообщения');
            return;
        }

        try {
            await api.delete('/messages/batch', {data: {message_ids: realIds}});
            setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)));
            exitSelectionMode();
        } catch (error) {
            console.error(error);
            alert('Не удалось удалить сообщения');
        }
    };

    const handleEditMessage = async (messageId: number) => {
        if (!editContent.trim()) return;
        try {
            const res = await api.patch(`/messages/${messageId}`, {content: editContent});
            setMessages(prev => prev.map(m => m.id === messageId ? res.data : m));
            setEditingMessageId(null);
            setEditContent('');
            setShowMenuFor(null);
        } catch (error) {
            console.error('Ошибка редактирования:', error);
        }
    };

    const handleDeleteMessage = async (messageId: number) => {
        if (!confirm('Удалить сообщение?')) return;
        try {
            await api.delete(`/messages/${messageId}`);
            setMessages(prev => prev.filter(m => m.id !== messageId));
        } catch (error) {
            console.error('Ошибка удаления:', error);
            alert('Не удалось удалить сообщение');
        }
    };

    const loadMoreMessages = async () => {
        if (loadingMore || !hasMore) return;
        if (messages.length === 0) return;

        setLoadingMore(true);
        const oldestMessageId = messages[0]?.id;

        try {
            const res = await api.get(`/messages/with/${userId}`, {
                params: {before: oldestMessageId, limit: 20}
            });

            const newMessages = res.data.messages || [];
            setHasMore(res.data.has_more !== false);

            if (newMessages.length > 0) {
                const container = messagesContainerRef.current;
                const firstMessageId = messages[0]?.id;

                setMessages(prev => [...newMessages, ...prev]);

                setTimeout(() => {
                    if (container && firstMessageId) {
                        const firstMessageElement = document.getElementById(`msg-${firstMessageId}`);
                        if (firstMessageElement) {
                            container.scrollTop = firstMessageElement.offsetTop - container.offsetTop;
                        }
                    }
                }, 0);
            }
        } catch (error) {
            console.error('Ошибка загрузки старых сообщений:', error);
        } finally {
            setLoadingMore(false);
        }
    };

    const handleScroll = () => {
        if (!messagesContainerRef.current) return;
        if (loadingMore || !hasMore) return;
        const {scrollTop} = messagesContainerRef.current;
        if (scrollTop < 100) loadMoreMessages();
    };

    useEffect(() => {
        const loadInitialMessages = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/messages/with/${userId}`, { params: { limit: 20 } });
                const loadedMessages = res.data.messages || [];
                setMessages(loadedMessages);
                setHasMore(res.data.has_more !== false);

                await api.patch(`/messages/read/${userId}`);
                wsService.sendReadReceipt(Number(userId));
                setMessages(prev =>
                    prev.map(m =>
                        m.from_id === Number(userId) ? { ...m, is_read: true } : m
                    )
                );

                window.dispatchEvent(new CustomEvent('reset-unread'));
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };

        const loadRecipient = async () => {
            try {
                const res = await api.get(`/users/${userId}`);
                setRecipient(res.data);
            } catch (error) {
                console.error(error);
            }
        };

        const handleMessage = (msg: any) => {
            if (msg.type === 'typing' && msg.from_id === Number(userId)) {
                setOtherTyping(msg.is_typing);
                return;
            }
            if (msg.type === 'message_deleted') {
                setMessages(prev => prev.filter(m => m.id !== msg.message_id));
                return;
            }
            if (msg.type === 'read_receipt' && msg.to_id === currentUser?.id) {
                setMessages(prev =>
                    prev.map(m =>
                        m.from_id === msg.to_id ? { ...m, is_read: true } : m
                    )
                );
                return;
            }
            if (msg.id && (msg.from_id === Number(userId) || msg.to_id === Number(userId))) {
                const messageWithRead = { ...msg, is_read: msg.is_read ?? false };

                setMessages(prev => {
                    const tempIndex = prev.findIndex(m =>
                        m.id > 10000000 &&
                        m.content === messageWithRead.content &&
                        m.from_id === currentUser?.id
                    );
                    if (tempIndex !== -1) {
                        const newMessages = [...prev];
                        newMessages[tempIndex] = messageWithRead;
                        return newMessages;
                    }
                    return [...prev, messageWithRead];
                });

                if (messageWithRead.from_id === Number(userId)) {
                    api.patch(`/messages/read/${userId}`).then(() => {
                        setMessages(prev => prev.map(m =>
                            m.from_id === Number(userId) ? { ...m, is_read: true } : m
                        ));
                        wsService.sendReadReceipt(Number(userId));
                    });
                }
            }
        };

        wsService.onMessage(handleMessage);
        wsService.connect();

        loadInitialMessages();
        loadRecipient();

        return () => {
            wsService.removeMessageHandler(handleMessage);
        };
    }, [userId]);

    useEffect(() => {
        if (!loading && messages.length > 0 && isFirstLoad.current) {
            messagesEndRef.current?.scrollIntoView({behavior: 'auto'});
            isFirstLoad.current = false;
        }
    }, [loading, messages]);

    const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNewMessage(e.target.value);
        if (!typingTimeoutRef.current) wsService.sendTyping(Number(userId), true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            wsService.sendTyping(Number(userId), false);
            typingTimeoutRef.current = null;
        }, 1000);
    };

    const sendMessage = () => {
        if (!newMessage.trim()) return;
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            wsService.sendTyping(Number(userId), false);
            typingTimeoutRef.current = null;
        }

        const tempId = Date.now();
        const tempMessage: Message = {
            id: tempId,
            from_id: currentUser?.id || 0,
            to_id: Number(userId),
            content: newMessage,
            created_at: new Date().toISOString(),
            is_read: false,
            from: {
                id: currentUser?.id || 0,
                name: currentUser?.name || '',
                email: currentUser?.email || ''
            }
        };
        setMessages(prev => [...prev, tempMessage]);
        wsService.send(Number(userId), newMessage);
        setNewMessage('');
    };

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === today.toDateString()) return 'Сегодня';
        if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
        return date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
    };

    if (loading) return (
        <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-gray-50">
            {/* Header */}
            <div className="bg-white px-6 py-4 flex items-center gap-3 shadow-sm sticky top-0 z-10">
                {selectionMode ? (
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                            <button onClick={exitSelectionMode} className="text-gray-500">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                            <span className="font-semibold">Выбрано: {selectedMessages.size}</span>
                        </div>
                        <button
                            onClick={() => setDeleteConfirmOpen(true)}
                            disabled={selectedMessages.size === 0}
                            className="text-red-500 disabled:opacity-50"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <div
                            className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                            {recipient?.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                            <h2 className="font-semibold text-gray-800">{recipient?.name || 'Пользователь'}</h2>
                            <p className="text-xs text-green-600">● Онлайн</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Messages */}
            <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-4 space-y-4"
            >
                {loadingMore && (
                    <div className="flex justify-center py-2">
                        <div
                            className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        Нет сообщений. Напишите что-нибудь...
                    </div>
                ) : (
                    messages.map((msg, idx) => {
                        const isOwn = msg.from_id === currentUser?.id;
                        const prevMsg = idx > 0 ? messages[idx - 1] : null;
                        const showDate = !prevMsg || formatDate(msg.created_at) !== formatDate(prevMsg.created_at);

                        return (
                            <div
                                key={msg.id}
                                id={`msg-${msg.id}`}
                                onTouchStart={() => handleTouchStart(msg.id)}
                                onTouchEnd={handleTouchEnd}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setSelectionMode(true);
                                    setSelectedMessages(new Set([msg.id]));
                                }}
                            >
                                {showDate && (
                                    <div className="flex justify-center my-4">
                                        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                                            {formatDate(msg.created_at)}
                                        </span>
                                    </div>
                                )}
                                <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                                    {selectionMode && (
                                        <div className="mr-2 flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedMessages.has(msg.id)}
                                                onChange={() => toggleSelectMessage(msg.id)}
                                                className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                            />
                                        </div>
                                    )}
                                    {!isOwn && !selectionMode && (
                                        <div
                                            className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 mr-2">
                                            {recipient?.name?.charAt(0).toUpperCase() || '?'}
                                        </div>
                                    )}
                                    <div className="relative max-w-[70%]">
                                        {editingMessageId === msg.id ? (
                                            <div className="bg-white rounded-2xl px-4 py-2 shadow-sm">
                                                <textarea
                                                    value={editContent}
                                                    onChange={e => setEditContent(e.target.value)}
                                                    className="w-full p-2 text-sm border rounded-lg resize-none"
                                                    rows={2}
                                                    autoFocus
                                                />
                                                <div className="flex gap-2 mt-2 justify-end">
                                                    <button onClick={() => handleEditMessage(msg.id)}
                                                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600">Сохранить
                                                    </button>
                                                    <button onClick={() => {
                                                        setEditingMessageId(null);
                                                        setEditContent('');
                                                    }}
                                                            className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Отмена
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                className={`rounded-2xl px-4 py-2 ${isOwn ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'}`}>
                                                <p className="text-sm wrap-break-word">{msg.content}</p>
                                                <div
                                                    className={`text-xs mt-1 ${isOwn ? 'text-blue-100 text-right' : 'text-gray-400 text-left'}`}>
                                                    {formatTime(msg.created_at)}
                                                    {isOwn && (
                                                        <span className="ml-1">
                                                        {msg.is_read ? '✓✓' : '✓'}
                                                    </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {!selectionMode && isOwn && (
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2 right-full mr-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                                <button onClick={() => {
                                                    setEditingMessageId(msg.id);
                                                    setEditContent(msg.content);
                                                }}
                                                        className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center shadow-sm">
                                                    <svg className="w-3.5 h-3.5 text-gray-600" fill="none"
                                                         stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round"
                                                              strokeWidth={2}
                                                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                                                    </svg>
                                                </button>
                                                <button onClick={() => handleDeleteMessage(msg.id)}
                                                        className="w-7 h-7 rounded-full bg-gray-200 hover:bg-red-200 flex items-center justify-center shadow-sm">
                                                    <svg className="w-3.5 h-3.5 text-gray-600 hover:text-red-500"
                                                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round"
                                                              strokeWidth={2}
                                                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        )}

                                        {!selectionMode && !isOwn && (
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2 -right-8 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                                <button onClick={() => handleDeleteMessage(msg.id)}
                                                        className="w-7 h-7 rounded-full bg-gray-200 hover:bg-red-200 flex items-center justify-center shadow-sm">
                                                    <svg className="w-3.5 h-3.5 text-gray-600 hover:text-red-500"
                                                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round"
                                                              strokeWidth={2}
                                                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
                {otherTyping && (
                    <div className="flex justify-start">
                        <div className="bg-white rounded-2xl px-4 py-2 shadow-sm">
                            <p className="text-sm text-gray-500">{recipient?.name} печатает...</p>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef}/>
            </div>

            {/* Input */}
            <div className="bg-white p-4">
                <div className="flex gap-2 items-end">
                    <textarea
                        value={newMessage}
                        onChange={handleTyping}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                        placeholder="Сообщение..."
                        rows={1}
                        className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-y-auto"
                        style={{maxHeight: '120px'}}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!newMessage.trim()}
                        className="w-10 h-10 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* Delete confirmation modal */}
            {deleteConfirmOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-sm mx-auto">
                        <h3 className="text-lg font-semibold mb-2">Удалить сообщения?</h3>
                        <p className="text-gray-600 mb-4">Вы уверены, что хотите удалить выбранные сообщения? Это
                            действие необратимо.</p>
                        <div className="flex gap-3">
                            <button onClick={handleBatchDelete}
                                    className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">Удалить
                            </button>
                            <button onClick={() => setDeleteConfirmOpen(false)}
                                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Отмена
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chat;