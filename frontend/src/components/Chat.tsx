import { useCallback, useEffect, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import type { User } from '../types.js';
import { messageService } from '../services/messageService.js';
import { userService } from '../services/userService.js';
import { useChatMessages } from '../hooks/useChatMessages.js';
import { useChatWebSocket } from '../hooks/useChatWebSocket.js';
import { useChatScroll } from '../hooks/useChatScroll.js';
import { useChatSelection } from '../hooks/useChatSelection.js';
import { useChatTyping } from '../hooks/useChatTyping.js';
import { ChatHeader } from './chat/ChatHeader.js';
import { ChatInput } from './chat/ChatInput.js';
import { ChatMessageList } from './chat/ChatMessageList.js';
import { DeleteConfirmModal } from './chat/DeleteConfirmModal.js';
import { useWebSocket } from '../contexts/WebSocketContext.js';
import { useAudioCall } from '../contexts/AudioCallContext.js';
import { Spinner } from './ui/Spinner.js';

const optimisticMessageFloor = 10000000;

function Chat() {
    const { userId } = useParams();
    const { currentUser } = useOutletContext<{ currentUser: User }>();
    const wsService = useWebSocket();
    const { status: callStatus, startCall } = useAudioCall();
    const [recipient, setRecipient] = useState<User | null>(null);
    const [newMessage, setNewMessage] = useState('');

    const {
        messages,
        setMessages,
        loadingMore,
        initialLoading,
        editingMessageId,
        setEditingMessageId,
        editContent,
        setEditContent,
        loadInitial,
        sendMessage: sendMessageToStore,
        updateMessage,
        deleteMessage,
        markAsRead,
    } = useChatMessages(userId, currentUser?.id);

    const { otherTyping, setOtherTyping, handleTyping } = useChatTyping(Number(userId));
    const { selectionMode, selectedMessages, deleteConfirmOpen, toggleSelect, enterSelectionMode, exitSelectionMode, openDeleteConfirm, closeDeleteConfirm } = useChatSelection();
    const { messagesEndRef, handleScroll } = useChatScroll([messages]);

    useChatWebSocket({
        userId,
        currentUserId: currentUser?.id,
        onTyping: setOtherTyping,
        onMessageDeleted: deleteMessage,
        onReadReceipt: markAsRead,
        onNewMessage: useCallback((msg) => {
            setMessages(prev => {
                const exists = prev.some(m => m.id === msg.id);
                if (exists) return prev;
                const optimisticIndex = prev.findIndex(m =>
                    m.id >= optimisticMessageFloor &&
                    m.from_id === msg.from_id &&
                    m.to_id === msg.to_id &&
                    m.content === msg.content
                );
                if (optimisticIndex !== -1) {
                    return prev.map((m, index) => index === optimisticIndex ? msg : m);
                }
                return [...prev, msg];
            });
            if (msg.from_id === Number(userId)) {
                wsService.sendReadReceipt(Number(userId));
                markAsRead(Number(userId));
            }
        }, [markAsRead, setMessages, userId, wsService]),
    });

    useEffect(() => {
        loadInitial();
        if (userId) {
            userService.getUser(userId).then(setRecipient).catch(console.error);
        }
    }, [loadInitial, userId]);

    useEffect(() => {
        if (!userId) return;
        wsService.sendReadReceipt(Number(userId));
        markAsRead(Number(userId));
        window.dispatchEvent(new Event('reset-unread'));
    }, [userId, wsService, markAsRead]);

    const handleBatchDelete = async () => {
        const realIds = Array.from(selectedMessages).filter(id => id > 0 && id < 10000000);
        if (!realIds.length) return alert('Нельзя удалить ещё не отправленные сообщения');
        try {
            await messageService.deleteMessagesBatch(realIds);
            setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)));
            exitSelectionMode();
        } catch (error) {
            console.error(error);
            alert('Не удалось удалить сообщения');
        }
    };

    const sendMessage = useCallback(() => {
        if (!newMessage.trim()) return;
        const tempMessage = {
            id: Date.now(),
            from_id: currentUser?.id || 0,
            to_id: Number(userId),
            content: newMessage,
            created_at: new Date().toISOString(),
            is_read: false,
            from: { id: currentUser?.id || 0, name: currentUser?.name || '', email: currentUser?.email || '' }
        };
        sendMessageToStore(newMessage, tempMessage);
        wsService.send(Number(userId), newMessage);
        setNewMessage('');
    }, [currentUser, newMessage, sendMessageToStore, userId, wsService]);

    if (initialLoading) return <div className="flex items-center justify-center h-[calc(100vh-120px)]"><Spinner /></div>;

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-gray-50">
            <ChatHeader
                recipientName={recipient?.name}
                selectionMode={selectionMode}
                selectedCount={selectedMessages.size}
                onExitSelection={exitSelectionMode}
                onDeleteClick={openDeleteConfirm}
                onStartAudioCall={
                    userId && callStatus === 'idle'
                        ? () => startCall(Number(userId), recipient?.name)
                        : undefined
                }
            />
            <ChatMessageList
                messages={messages}
                currentUserId={currentUser?.id}
                recipientName={recipient?.name}
                selectionMode={selectionMode}
                selectedMessages={selectedMessages}
                onToggleSelect={toggleSelect}
                onEnterSelectionMode={enterSelectionMode}
                onEditMessage={(id, content) => {
                    setEditingMessageId(id);
                    setEditContent(content);
                }}
                onDeleteMessage={deleteMessage}
                editingMessageId={editingMessageId}
                editContent={editContent}
                setEditContent={setEditContent}
                onSaveEdit={updateMessage}
                onCancelEdit={() => setEditingMessageId(null)}
                loadingMore={loadingMore}
                onScroll={handleScroll}
                messagesEndRef={messagesEndRef}
                formatDate={(date) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                formatTime={(date) => new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            />
            {otherTyping && <div className="px-4 pb-2 text-sm text-gray-500">{recipient?.name} печатает...</div>}
            <ChatInput value={newMessage} onChange={e => { setNewMessage(e.target.value); handleTyping(); }} onSend={sendMessage} />
            <DeleteConfirmModal isOpen={deleteConfirmOpen} onConfirm={handleBatchDelete} onCancel={closeDeleteConfirm} />
        </div>
    );
}

export default Chat;
