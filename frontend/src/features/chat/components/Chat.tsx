import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
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
import {usePresence} from "@/shared/hooks/usePresence.js";
import { getUploadErrorMessage } from "@/shared/api/errors.js";
import {
    dataTransferHasFiles,
    dataTransferHasImages,
    filesFromDataTransfer,
    imageFilesFromClipboard,
    compressChatImage,
} from "@/shared/utils/uploadValidation.js";

const optimisticMessageFloor = 10000000;

function Chat() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useOutletContext<{ currentUser: User }>();
    const wsService = useWebSocket();
    const { status: callStatus, startCall, startVideoCall } = useAudioCall();
    const [recipient, setRecipient] = useState<User | null>(null);
    const [newMessage, setNewMessage] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [sendStatus, setSendStatus] = useState('');
    const [draggingImage, setDraggingImage] = useState(false);
    const [incomingFiles, setIncomingFiles] = useState<{ id: number; files: File[] } | null>(null);
    const dragDepthRef = useRef(0);

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
    const { online } = usePresence(recipient?.id);

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

        const attachments: MessageAttachment[] = [];

        for (const [index, file] of files.entries()) {
            setSendStatus(`Подготавливаем изображение ${index + 1} из ${files.length}`);
            const compressedFile = await compressChatImage(file);
            setSendStatus(`Загружаем изображение ${index + 1} из ${files.length}`);
            attachments.push(await messageService.uploadImage(compressedFile));
        }

        return attachments;
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
        if (!content && files.length === 0) return false;
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            setUploadError('Подтвердите email, чтобы продолжить');
            return false;
        }

        try {
            setUploadError('');
            setSendStatus(files.length ? 'Подготавливаем изображения' : 'Отправляем сообщение');
            const attachments = await uploadAttachments(files);
            setSendStatus('Отправляем сообщение');

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
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(getUploadErrorMessage(error, 'Не удалось загрузить картинку'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, newMessage, sendMessageToStore, uploadAttachments, userId, wsService]);

    const queueFilesForPreview = useCallback((files: File[]) => {
        if (!files.length) {
            return;
        }

        setUploadError('');
        setIncomingFiles({
            id: Date.now(),
            files,
        });
    }, []);

    const resetDragState = () => {
        dragDepthRef.current = 0;
        setDraggingImage(false);
    };

    const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        dragDepthRef.current += 1;

        if (dataTransferHasImages(event.dataTransfer)) {
            setDraggingImage(true);
        }
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';

        if (dataTransferHasImages(event.dataTransfer)) {
            setDraggingImage(true);
        }
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer) && dragDepthRef.current === 0) {
            return;
        }

        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

        if (dragDepthRef.current === 0) {
            setDraggingImage(false);
        }
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        resetDragState();
        queueFilesForPreview(filesFromDataTransfer(event.dataTransfer));
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
        const files = imageFilesFromClipboard(event.clipboardData);

        if (!files.length) {
            return;
        }

        event.preventDefault();
        queueFilesForPreview(files);
    };

    if (initialLoading) return <div className="flex h-full items-center justify-center sm:h-[calc(100vh-120px)]"><Spinner /></div>;

    return (
        <div
            className="relative flex h-full flex-col overflow-hidden bg-[#f4f5f7] sm:h-[calc(100vh-120px)] sm:rounded-2xl sm:border sm:border-gray-200/80"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
        >
            {draggingImage && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[1px]">
                    <div className="rounded-2xl border-2 border-dashed border-white/80 bg-white/90 px-6 py-5 text-center shadow-xl">
                        <p className="text-sm font-semibold text-gray-900 sm:text-base">
                            Отпустите изображение для отправки
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                            Перед отправкой появится предпросмотр
                        </p>
                    </div>
                </div>
            )}

            <ChatHeader
                recipientName={recipient?.name}
                recipientStatus={online}
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
            <ChatInput
                value={newMessage}
                onChange={e => {
                    setNewMessage(e.target.value);
                    setUploadError('');
                    handleTyping();
                }}
                onSend={sendMessage}
                errorMessage={uploadError}
                onErrorMessageChange={setUploadError}
                incomingFiles={incomingFiles}
                onIncomingFilesConsumed={() => setIncomingFiles(null)}
                sendStatus={sendStatus}
            />
            <DeleteConfirmModal isOpen={deleteConfirmOpen} onConfirm={handleBatchDelete} onCancel={closeDeleteConfirm} />
        </div>
    );
}

export default Chat;
