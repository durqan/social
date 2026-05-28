import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { MessageAttachment, User } from "@/shared/types/domain.js";
import { messageService } from "@/features/chat/api/messageService.js";
import { userService } from "@/shared/api/userService.js";
import { useChatMessages } from "@/features/chat/hooks/useChatMessages.js";
import { useChatWebSocket } from "@/features/chat/hooks/useChatWebSocket.js";
import { useChatScroll } from "@/features/chat/hooks/useChatScroll.js";
import { useChatSelection } from "@/features/chat/hooks/useChatSelection.js";
import { useChatTyping } from "@/features/chat/hooks/useChatTyping.js";
import { ChatHeader } from "@/features/chat/components/ChatHeader.js";
import { ChatInput } from "@/features/chat/components/ChatInput.js";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList.js";
import { DeleteConfirmModal } from "@/features/chat/components/DeleteConfirmModal.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { useAudioCall } from "@/features/call/AudioCallContext.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { formatMonthDayDate, formatTime } from "@/shared/utils/date.js";

const optimisticMessageFloor = 10000000;

function Chat() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useOutletContext<{ currentUser: User }>();
    const wsService = useWebSocket();
    const { status: callStatus, startCall, startVideoCall } = useAudioCall();
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
    }, [markAsRead, userId, wsService]);

    const uploadAttachments = useCallback(async (files: File[]): Promise<MessageAttachment[]> => {
        if (!files.length) return [];

        if (files.length > 5) {
            throw new Error('Можно отправить максимум 5 картинок за раз');
        }

        return Promise.all(
            files.map(file => messageService.uploadImage(file))
        );
    }, []);

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

    const sendMessage = useCallback(async (files: File[] = []) => {
        const content = newMessage.trim();
        if (!content && files.length === 0) return;
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            alert('Подтвердите email, чтобы продолжить');
            return;
        }

        try {
            const attachments = await uploadAttachments(files);

            const tempMessage = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                created_at: new Date().toISOString(),
                is_read: false,
                from: { id: currentUser?.id || 0, name: currentUser?.name || '', email: currentUser?.email || '' },
                attachments,
            };

            sendMessageToStore(content, tempMessage);
            wsService.send(Number(userId), content, attachments);
            setNewMessage('');
        } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : 'Не удалось отправить картинку');
        }
    }, [currentUser, newMessage, sendMessageToStore, uploadAttachments, userId, wsService]);

    if (initialLoading) return <div className="flex h-full items-center justify-center sm:h-[calc(100vh-120px)]"><Spinner /></div>;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#f4f5f7] sm:h-[calc(100vh-120px)] sm:rounded-2xl sm:border sm:border-gray-200/80">
            <ChatHeader
                recipientName={recipient?.name}
                selectionMode={selectionMode}
                selectedCount={selectedMessages.size}
                onBack={() => navigate(`/users/${currentUser?.id}/conversations`)}
                onExitSelection={exitSelectionMode}
                onDeleteClick={openDeleteConfirm}
                onStartAudioCall={
                    userId && callStatus === 'idle'
                        ? () => startCall(Number(userId), recipient?.name)
                        : undefined
                }
                onStartVideoCall={
                    userId && callStatus === 'idle'
                        ? () => startVideoCall(Number(userId), recipient?.name)
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
                formatDate={formatMonthDayDate}
                formatTime={formatTime}
            />
            {otherTyping && <div className="px-4 pb-2 text-sm text-gray-500">{recipient?.name} печатает...</div>}
            <ChatInput value={newMessage} onChange={e => { setNewMessage(e.target.value); handleTyping(); }} onSend={sendMessage} />
            <DeleteConfirmModal isOpen={deleteConfirmOpen} onConfirm={handleBatchDelete} onCancel={closeDeleteConfirm} />
        </div>
    );
}

export default Chat;
