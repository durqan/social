import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { Message, MessageAttachment, User } from "@/shared/types/domain.js";
import { messageService } from "@/features/chat/api/messageService.js";
import { friendService } from "@/features/friends/api/friendService.js";
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
import { Avatar } from "@/shared/ui/Avatar.js";
import { messageAuthorName, messagePreviewText } from "@/features/chat/lib/messagePreview.js";
import {
    dataTransferHasFiles,
    dataTransferHasImages,
    filesFromDataTransfer,
    imageFilesFromClipboard,
    compressChatImage,
    validateVoiceFile,
    validateVideoNoteFile,
} from "@/shared/utils/uploadValidation.js";

const optimisticMessageFloor = 10000000;

function attachmentsMatchOptimistic(pending: Message, received: Message) {
    const pendingAttachments = pending.attachments || [];
    const receivedAttachments = received.attachments || [];

    if (pendingAttachments.length !== receivedAttachments.length) {
        return false;
    }

    return pendingAttachments.every((attachment, index) => {
        const receivedAttachment = receivedAttachments[index];

        if (!receivedAttachment || attachment.file_type !== receivedAttachment.file_type) {
            return false;
        }

        if (attachment.file_type === 'voice' || attachment.file_type === 'video_note') {
            return (attachment.duration_seconds || attachment.duration || 0) ===
                (receivedAttachment.duration_seconds || receivedAttachment.duration || 0);
        }

        return attachment.width === receivedAttachment.width &&
            attachment.height === receivedAttachment.height &&
            attachment.size === receivedAttachment.size;
    });
}

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
    const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
    const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
    const [forwardFriends, setForwardFriends] = useState<User[]>([]);
    const [forwardSelectedIds, setForwardSelectedIds] = useState<Set<number>>(new Set());
    const [forwardLoading, setForwardLoading] = useState(false);
    const [forwardError, setForwardError] = useState('');
    const dragDepthRef = useRef(0);

    const {
        messages,
        setMessages,
        hasMore,
        loadingMore,
        initialLoading,
        editingMessageId,
        setEditingMessageId,
        editContent,
        setEditContent,
        loadInitial,
        loadMore,
        sendMessage: sendMessageToStore,
        updateMessage,
        applyMessageUpdate,
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
                    m.content === msg.content &&
                    (m.reply_to_message_id ?? null) === (msg.reply_to_message_id ?? null) &&
                    attachmentsMatchOptimistic(m, msg)
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
        onMessageUpdated: applyMessageUpdate,
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

    const replyPreview = useMemo(() => {
        if (!replyToMessage) {
            return null;
        }

        return {
            author: messageAuthorName(replyToMessage),
            text: messagePreviewText(replyToMessage),
        };
    }, [replyToMessage]);

    const handleBatchDelete = async () => {
        const realIds = messages
            .filter(message => selectedMessages.has(message.id))
            .filter(message => message.from_id === currentUser?.id)
            .filter(message => message.id > 0 && message.id < 10000000)
            .map(message => message.id);
        if (!realIds.length) return alert('Нельзя удалить ещё не отправленные сообщения');
        try {
            await messageService.deleteMessagesBatch(realIds);
            setMessages(prev => prev.filter(m => !realIds.includes(m.id)));
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
                reply_to_message_id: replyToMessage?.id ?? null,
                reply_to_message: replyToMessage,
                forwarded_from_message_id: null,
                forwarded_from_user_id: null,
                forwarded_from_message: null,
                forwarded_from_user: null,
                from: { id: currentUser?.id || 0, name: currentUser?.name || '', email: currentUser?.email || '' },
                attachments,
            };

            sendMessageToStore(content, tempMessage);
            wsService.send(Number(userId), content, attachments, replyToMessage?.id);
            setNewMessage('');
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(getUploadErrorMessage(error, 'Не удалось загрузить картинку'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, newMessage, replyToMessage, sendMessageToStore, uploadAttachments, userId, wsService]);

    const sendVoiceMessage = useCallback(async (file: File, durationSeconds: number, text?: string) => {
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            setUploadError('Подтвердите email, чтобы продолжить');
            return false;
        }

        const validationError = validateVoiceFile(file, durationSeconds);
        if (validationError) {
            setUploadError(validationError);
            return false;
        }

        try {
            setUploadError('');
            setSendStatus('Загружаем голосовое сообщение');
            const attachment = await messageService.uploadVoice(file, durationSeconds);
            const attachments = [attachment];
            setSendStatus('Отправляем голосовое сообщение');

            const content = (text ?? '').trim();

            const tempMessage: Message = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                created_at: new Date().toISOString(),
                is_read: false,
                reply_to_message_id: replyToMessage?.id ?? null,
                reply_to_message: replyToMessage,
                forwarded_from_message_id: null,
                forwarded_from_user_id: null,
                forwarded_from_message: null,
                forwarded_from_user: null,
                from: { id: currentUser?.id || 0, name: currentUser?.name || '', email: currentUser?.email || '' },
                attachments,
            };

            sendMessageToStore(content, tempMessage);
            wsService.send(Number(userId), content, attachments, replyToMessage?.id);
            if (content) {
                setNewMessage('');
            }
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(getUploadErrorMessage(error, 'Не удалось отправить голосовое сообщение'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, newMessage, replyToMessage, sendMessageToStore, userId, wsService]);

    const sendVideoNoteMessage = useCallback(async (file: File, durationSeconds: number, text?: string) => {
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            setUploadError('Подтвердите email, чтобы продолжить');
            return false;
        }

        const validationError = validateVideoNoteFile(file, durationSeconds);
        if (validationError) {
            setUploadError(validationError);
            return false;
        }

        try {
            setUploadError('');
            setSendStatus('Загружаем видео-сообщение');
            const attachment = await messageService.uploadVideoNote(file, durationSeconds);
            const attachments = [attachment];
            setSendStatus('Отправляем видео-сообщение');

            const content = (text ?? '').trim();

            const tempMessage: Message = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                created_at: new Date().toISOString(),
                is_read: false,
                reply_to_message_id: replyToMessage?.id ?? null,
                reply_to_message: replyToMessage,
                forwarded_from_message_id: null,
                forwarded_from_user_id: null,
                forwarded_from_message: null,
                forwarded_from_user: null,
                from: { id: currentUser?.id || 0, name: currentUser?.name || '', email: currentUser?.email || '' },
                attachments,
            };

            sendMessageToStore(content, tempMessage);
            wsService.send(Number(userId), content, attachments, replyToMessage?.id);
            if (content) {
                setNewMessage('');
            }
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(getUploadErrorMessage(error, 'Не удалось отправить видео-сообщение'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, newMessage, replyToMessage, sendMessageToStore, userId, wsService]);

    const openForwardDialog = useCallback((message: Message) => {
        setForwardMessage(message);
        setForwardSelectedIds(new Set());
        setForwardError('');
        setForwardLoading(true);
        friendService.getFriendsList()
            .then(setForwardFriends)
            .catch(error => {
                console.error(error);
                setForwardError('Не удалось загрузить список друзей');
            })
            .finally(() => setForwardLoading(false));
    }, []);

    const closeForwardDialog = () => {
        if (forwardLoading) {
            return;
        }

        setForwardMessage(null);
        setForwardSelectedIds(new Set());
        setForwardError('');
    };

    const toggleForwardRecipient = (friendId?: number) => {
        if (!friendId) {
            return;
        }

        setForwardSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(friendId)) {
                next.delete(friendId);
            } else {
                next.add(friendId);
            }
            return next;
        });
    };

    const submitForward = async () => {
        if (!forwardMessage || forwardSelectedIds.size === 0) {
            return;
        }

        setForwardLoading(true);
        setForwardError('');

        try {
            const forwarded = await messageService.forwardMessage(forwardMessage.id, Array.from(forwardSelectedIds));
            setMessages(prev => {
                const existingIds = new Set(prev.map(message => message.id));
                const currentChatMessages = forwarded.filter(message =>
                    !existingIds.has(message.id) &&
                    (message.from_id === Number(userId) || message.to_id === Number(userId))
                );

                return currentChatMessages.length ? [...prev, ...currentChatMessages] : prev;
            });
            setForwardMessage(null);
            setForwardSelectedIds(new Set());
        } catch (error) {
            console.error(error);
            setForwardError('Не удалось переслать сообщение');
        } finally {
            setForwardLoading(false);
        }
    };

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
            className="relative flex h-full flex-col overflow-hidden bg-bg sm:h-[calc(100vh-120px)] sm:rounded-2xl sm:border sm:border-border"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
        >
            {draggingImage && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px]">
                    <div className="rounded-2xl border-2 border-dashed border-primary/60 bg-surface/90 px-6 py-5 text-center shadow-app">
                        <p className="text-sm font-semibold text-text sm:text-base">
                            Отпустите изображение для отправки
                        </p>
                        <p className="mt-1 text-xs text-text-secondary">
                            Перед отправкой появится предпросмотр
                        </p>
                    </div>
                </div>
            )}

            <ChatHeader
                recipientId={recipient?.id}
                recipientName={recipient?.name}
                recipientAvatar={recipient?.avatar}
                recipientAvatarPositionX={recipient?.avatarPositionX}
                recipientAvatarPositionY={recipient?.avatarPositionY}
                recipientAvatarScale={recipient?.avatarScale}
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
                recipientAvatar={recipient?.avatar}
                recipientAvatarPositionX={recipient?.avatarPositionX}
                recipientAvatarPositionY={recipient?.avatarPositionY}
                recipientAvatarScale={recipient?.avatarScale}
                selectionMode={selectionMode}
                selectedMessages={selectedMessages}
                onToggleSelect={toggleSelect}
                onEnterSelectionMode={enterSelectionMode}
                onReplyMessage={setReplyToMessage}
                onForwardMessage={openForwardDialog}
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
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                onScroll={handleScroll}
                messagesEndRef={messagesEndRef}
                formatDate={formatMonthDayDate}
                formatTime={formatTime}
            />
            {otherTyping && <div className="px-4 pb-2 text-sm text-text-secondary">{recipient?.name} печатает...</div>}
            <ChatInput
                value={newMessage}
                onChange={e => {
                    setNewMessage(e.target.value);
                    setUploadError('');
                    handleTyping();
                }}
                onSend={sendMessage}
                onSendVoice={sendVoiceMessage}
                onSendVideoNote={sendVideoNoteMessage}
                errorMessage={uploadError}
                onErrorMessageChange={setUploadError}
                incomingFiles={incomingFiles}
                onIncomingFilesConsumed={() => setIncomingFiles(null)}
                sendStatus={sendStatus}
                replyPreview={replyPreview}
                onCancelReply={() => setReplyToMessage(null)}
            />
            {forwardMessage && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                    <div className="app-card w-full max-w-md p-4 shadow-xl sm:p-5">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-text">Переслать сообщение</h2>
                                <p className="truncate text-sm text-text-secondary">{messagePreviewText(forwardMessage)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeForwardDialog}
                                disabled={forwardLoading}
                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface-hover"
                                aria-label="Закрыть"
                            >
                                x
                            </button>
                        </div>

                        <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                            {forwardLoading && forwardFriends.length === 0 ? (
                                <div className="flex justify-center p-5"><Spinner size="sm" /></div>
                            ) : forwardFriends.length === 0 ? (
                                <div className="p-4 text-center text-sm text-text-secondary">Нет доступных получателей</div>
                            ) : (
                                forwardFriends.map(friend => (
                                    <label key={friend.id} className="flex cursor-pointer items-center gap-3 border-b border-border p-3 last:border-b-0 hover:bg-surface-hover">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(friend.id && forwardSelectedIds.has(friend.id))}
                                            onChange={() => toggleForwardRecipient(friend.id)}
                                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                        />
                                        <Avatar
                                            name={friend.name}
                                            src={friend.avatar}
                                            userId={friend.id}
                                            positionX={friend.avatarPositionX}
                                            positionY={friend.avatarPositionY}
                                            scale={friend.avatarScale}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                                            {friend.name || friend.email}
                                        </span>
                                    </label>
                                ))
                            )}
                        </div>

                        {forwardError && (
                            <div className="mt-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                                {forwardError}
                            </div>
                        )}

                        <div className="mt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={submitForward}
                                disabled={forwardLoading || forwardSelectedIds.size === 0}
                                className="flex-1 rounded-xl bg-primary px-4 py-2 text-white transition hover:bg-primary-hover disabled:opacity-50"
                            >
                                {forwardLoading ? 'Отправляем...' : 'Переслать'}
                            </button>
                            <button
                                type="button"
                                onClick={closeForwardDialog}
                                disabled={forwardLoading}
                                className="flex-1 rounded-xl bg-surface-hover px-4 py-2 text-text transition hover:bg-surface disabled:opacity-50"
                            >
                                Отмена
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <DeleteConfirmModal isOpen={deleteConfirmOpen} onConfirm={handleBatchDelete} onCancel={closeDeleteConfirm} />
        </div>
    );
}

export default Chat;
