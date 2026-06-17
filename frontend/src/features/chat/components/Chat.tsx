import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import type { Message, MessageAttachment, PinnedMessage, User } from "@/shared/types/domain.js";
import { messageService, type MessageDeleteMode } from "@/features/chat/api/messageService.js";
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
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import { useAudioCall } from "@/features/call/AudioCallContext.js";
import { toast } from 'react-hot-toast';
import { Spinner } from "@/shared/ui/Spinner.js";
import { formatMonthDayDate, formatTime } from "@/shared/utils/date.js";
import {usePresence} from "@/shared/hooks/usePresence.js";
import { getUploadErrorMessage } from "@/shared/api/errors.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";
import { messageAuthorName, messagePreviewText } from "@/features/chat/lib/messagePreview.js";
import { e2eeService } from "@/shared/api/e2eeService.js";
import { encryptMessage, type EncryptedMessagePayload } from "@/crypto/encryptMessage.js";
import {
    encryptAttachmentForUpload,
    fileFromDecryptedAttachment,
    isEncryptedAttachment,
    type AttachmentFileType,
    type AttachmentPlainMetadata,
    type EncryptedAttachmentFields,
} from "@/crypto/attachment.js";
import { getLocalE2EEKeyBundle, type LocalE2EEKeyBundle } from "@/crypto/masterKey.js";
import { decryptMessageForDisplay, decryptMessagesForDisplay } from "@/features/chat/lib/e2eeMessageTransform.js";
import {
    dataTransferHasFiles,
    filesFromDataTransfer,
    compressChatImage,
    chatAttachmentKindForFile,
    validateChatAttachments,
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
                (receivedAttachment.duration_seconds || receivedAttachment.duration || 0) &&
                attachment.size === receivedAttachment.size;
        }

        if (attachment.file_type === 'video' || attachment.file_type === 'audio' || attachment.file_type === 'file') {
            return attachment.size === receivedAttachment.size;
        }

        return attachment.width === receivedAttachment.width &&
            attachment.height === receivedAttachment.height &&
            attachment.size === receivedAttachment.size;
    });
}

function messagesMatchOptimistic(pending: Message, received: Message) {
    const sameText = pending.content === received.content ||
        Boolean(pending.ciphertext && pending.ciphertext === received.ciphertext);

    return sameText &&
        (pending.reply_to_message_id ?? null) === (received.reply_to_message_id ?? null) &&
        attachmentsMatchOptimistic(pending, received);
}

function pinnedMessageText(message: Message) {
    const content = message.content?.trim();
    if (content) {
        return content;
    }

    if (message.attachments?.some(attachment => attachment.file_type === 'image')) {
        return 'Изображение';
    }
    if (message.attachments?.some(attachment => attachment.file_type === 'video')) {
        return 'Видео';
    }
    if (message.attachments?.some(attachment => attachment.file_type === 'audio')) {
        return 'Аудио';
    }
    if (message.attachments?.some(attachment => attachment.file_type === 'file')) {
        return 'Файл';
    }

    return messagePreviewText(message);
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        try {
            return {
                width: bitmap.width,
                height: bitmap.height,
            };
        } finally {
            bitmap.close();
        }
    }

    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('invalid image'));
        };
        image.src = url;
    });
}

function attachmentDisplayFallback(fileType: AttachmentFileType) {
    switch (fileType) {
        case 'voice':
            return 'voice-message.webm';
        case 'video_note':
            return 'video-note.webm';
        case 'video':
            return 'video.mp4';
        case 'audio':
            return 'audio.mp3';
        case 'file':
            return 'file.bin';
        default:
            return 'image.jpg';
    }
}

function fallbackMimeType(fileType: AttachmentFileType) {
    switch (fileType) {
        case 'voice':
            return 'audio/webm';
        case 'video_note':
            return 'video/webm';
        case 'video':
            return 'video/mp4';
        case 'audio':
            return 'audio/mpeg';
        case 'file':
            return 'application/octet-stream';
        default:
            return 'image/jpeg';
    }
}

function fallbackAttachmentFilename(fileType: AttachmentFileType) {
    return attachmentDisplayFallback(fileType);
}

async function fileFromRemoteAttachment(attachment: MessageAttachment): Promise<File> {
    if (attachment.decrypted_file_url && !attachment.decryption_error) {
        return fileFromDecryptedAttachment(attachment);
    }

    if (attachment.decryption_error) {
        throw new Error('Attachment is not decrypted');
    }

    const response = await fetch(attachment.file_url, {
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to load attachment');
    }
    const blob = await response.blob();
    const type = attachment.original_mime_type || attachment.content_type || blob.type || fallbackMimeType(attachment.file_type);
    return new File([blob], attachment.original_filename || fallbackAttachmentFilename(attachment.file_type), {
        type,
        lastModified: Date.now(),
    });
}

function attachmentKindFromFile(file: File): AttachmentFileType {
    const kind = chatAttachmentKindForFile(file);
    if (!kind) {
        throw new Error('Этот тип вложения не поддерживается');
    }
    return kind;
}

function prepareFileForUpload(file: File, fileType: AttachmentFileType) {
    if (fileType === 'image') {
        return compressChatImage(file);
    }
    return Promise.resolve(file);
}

async function dimensionsForUpload(file: File, fileType: AttachmentFileType) {
    if (fileType !== 'image') {
        return {};
    }
    try {
        return {
            ...(await imageDimensions(file)),
        };
    } catch {
        throw new Error('Изображение повреждено или не поддерживается.');
    }
}

function withDecryptedAttachmentPreview(
    attachment: MessageAttachment,
    file: File,
    metadata: AttachmentPlainMetadata,
    fields: EncryptedAttachmentFields,
): MessageAttachment {
    return {
        ...attachment,
        ...fields,
        decrypted_file_url: URL.createObjectURL(file),
        original_mime_type: metadata.mimeType,
        original_filename: metadata.filename,
        original_size: metadata.size,
        width: attachment.width ?? metadata.width,
        height: attachment.height ?? metadata.height,
        duration_seconds: attachment.duration_seconds ?? metadata.durationSeconds,
        duration: attachment.duration ?? metadata.durationSeconds,
        decryption_error: false,
    };
}

function attachmentForTransport(attachment: MessageAttachment): MessageAttachment {
    return {
        id: attachment.id,
        attachment_id: attachment.attachment_id,
        message_id: attachment.message_id,
        file_url: attachment.file_url,
        file_type: attachment.file_type,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration,
        duration_seconds: attachment.duration_seconds,
        size: attachment.size,
        original_filename: attachment.original_filename,
        content_type: attachment.content_type,
        encryption_version: attachment.encryption_version,
        encrypted_file_key: attachment.encrypted_file_key,
        file_nonce: attachment.file_nonce,
        encrypted_metadata: attachment.encrypted_metadata,
        created_at: attachment.created_at,
    };
}

function PinnedMessageBanner({
    pinnedMessage,
    onClick,
    onUnpin,
}: {
    pinnedMessage: PinnedMessage | null;
    onClick: () => void;
    onUnpin: () => void | Promise<void>;
}) {
    if (!pinnedMessage) {
        return null;
    }

    const pinnedByName = pinnedMessage.pinned_by?.name || 'Пользователь';

    return (
        <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 shadow-sm sm:px-4">
            <button
                type="button"
                onClick={onClick}
                className="group flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                    <Icon name="pin" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--app-text-secondary)]">
                        Закрепил(а) {pinnedByName}
                    </span>
                    <span className="block truncate text-sm font-medium text-[var(--app-text-primary)]">
                        {pinnedMessageText(pinnedMessage.message)}
                    </span>
                </span>
            </button>
            <button
                type="button"
                onClick={() => {
                    void onUnpin();
                }}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-gray-100 hover:text-gray-900"
                aria-label="Открепить сообщение"
            >
                <Icon name="close" className="h-4 w-4" />
            </button>
        </div>
    );
}

function Chat() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const dialog = useAppDialog();
    const { currentUser } = useOutletContext<{ currentUser: User }>();
    const wsService = useWebSocket();
    const { status: callStatus, startCall, startVideoCall } = useAudioCall();

    // Handle deep links coming from web push notifications for incoming calls.
    // The URL looks like /users/:me/chat/:peer?incomingCall=1&callId=xxx&ts=...
    // We do NOT auto-accept here (the real offer still arrives over WS if the caller is still trying).
    // If the offer has already expired, we show a lightweight "missed call" hint.
    // Uses setSearchParams + replace to cleanly remove the params (prevents re-processing on refresh).
    const [searchParams, setSearchParams] = useSearchParams();
    const [recipient, setRecipient] = useState<User | null>(null);
    const [e2eeState, setE2eeState] = useState<{
        loading: boolean;
        selfEnabled: boolean;
        recipientEnabled: boolean;
        recipientPublicKey: string;
        localKey: LocalE2EEKeyBundle | null;
    }>({
        loading: true,
        selfEnabled: false,
        recipientEnabled: false,
        recipientPublicKey: '',
        localKey: null,
    });
    const [newMessage, setNewMessage] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [sendStatus, setSendStatus] = useState('');
    const [draggingFile, setDraggingFile] = useState(false);
    const [incomingFiles, setIncomingFiles] = useState<{ id: number; files: File[] } | null>(null);
    const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
    const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
    const [forwardFriends, setForwardFriends] = useState<User[]>([]);
    const [forwardSelectedIds, setForwardSelectedIds] = useState<Set<number>>(new Set());
    const [forwardLoading, setForwardLoading] = useState(false);
    const [forwardError, setForwardError] = useState('');
    const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
    const [scrollToMessageRequest, setScrollToMessageRequest] = useState<{ messageId: number; requestId: number } | null>(null);
    const dragDepthRef = useRef(0);

    const transformChatMessages = useCallback((items: Message[]) => (
        decryptMessagesForDisplay(items, currentUser?.id, e2eeState.localKey)
    ), [currentUser?.id, e2eeState.localKey]);

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
        loadUntilMessage,
        sendMessage: sendMessageToStore,
        updateMessage,
        applyMessageUpdate,
        deleteMessage,
        markAsRead,
    } = useChatMessages(userId, currentUser?.id, transformChatMessages);

    const { otherTyping, setOtherTyping, handleTyping } = useChatTyping(Number(userId));
    const { selectionMode, selectedMessages, toggleSelect, enterSelectionMode, exitSelectionMode } = useChatSelection();
    const { messagesEndRef, handleScroll, forceScrollToBottom, scrollToBottomIfNeeded } = useChatScroll(userId);
    const { online } = usePresence(recipient?.id);
    const e2eeReady = Boolean(
        currentUser?.id &&
        e2eeState.selfEnabled &&
        e2eeState.recipientEnabled &&
        e2eeState.recipientPublicKey &&
        e2eeState.localKey
    );

    // Handle deep link from web push for incoming calls (checklist items 8-9).
    // - Reads incomingCall, callId, ts
    // - Cleans query via setSearchParams({replace:true}) — safe even if currentUser not loaded yet
    // - TTL ~45-60s: if older → "Пропущенный звонок", else do nothing extra (rely on the normal call offer event + CallOverlay)
    // - Guard with processedCallRef so a single push click / load is handled only once (avoids re-toast on searchParams update after replace).
    const processedCallRef = useRef<string | null>(null);

    useEffect(() => {
        const incomingCall = searchParams.get('incomingCall');
        const callId = searchParams.get('callId');
        const tsParam = searchParams.get('ts');

        if (!incomingCall || !userId) {
            return;
        }

        // Dedup guard: if we already handled this exact callId (or a synthetic key), skip.
        const processingKey = callId || `peer-${userId}-${tsParam || 'no-ts'}`;
        if (processedCallRef.current === processingKey) {
            return;
        }

        const peerId = Number(userId);
        if (!peerId) return;

        const now = Date.now();
        const offerTs = tsParam ? Number(tsParam) : now;
        const ageMs = now - (Number.isFinite(offerTs) ? offerTs : now);
        const isStale = ageMs > 60000; // 60s TTL (within the 45-60s range requested)

        // Clean the query params using the searchParams API + replace.
        // This is better than reconstructing full path because we are already on the correct chat route.
        const next = new URLSearchParams(searchParams);
        next.delete('incomingCall');
        next.delete('callId');
        next.delete('ts');

        // Mark as processed *before* the state update to avoid double execution in the same render cycle.
        processedCallRef.current = processingKey;

        setSearchParams(next, { replace: true });

        if (isStale) {
            // Call offer is very likely already gone on the caller side (caller gave up or answered elsewhere).
            // We deliberately do not attempt to synthesize a call here.
            toast('Пропущенный звонок', {
                duration: 4000,
                position: 'top-center',
            });
            return;
        }

        // Fresh enough. Do NOT manually start/accept anything.
        // The normal websocket call offer event (if the caller is still offering) will arrive via AudioCallContext
        // (which is mounted at App level) and will show the CallOverlay as usual.
    }, [searchParams, userId, setSearchParams]);

    const decryptIncomingMessage = useCallback(async (message: Message) => {
        if (!currentUser?.id || !e2eeState.localKey) {
            const [fallback] = await decryptMessagesForDisplay([message], currentUser?.id, e2eeState.localKey);
            return fallback || message;
        }
        return decryptMessageForDisplay(message, currentUser.id, e2eeState.localKey);
    }, [currentUser?.id, e2eeState.localKey]);

    const encryptContentForRecipient = useCallback(async (
        content: string,
        recipientId: number,
        recipientPublicKey?: string,
    ): Promise<EncryptedMessagePayload | undefined> => {
        if (!content) {
            return undefined;
        }
        if (!currentUser?.id || !e2eeState.localKey || !e2eeState.selfEnabled) {
            return undefined;
        }

        let publicKey = recipientPublicKey;
        if (!publicKey) {
            const status = await e2eeService.getStatus(recipientId);
            if (!status.enabled || !status.public_key) {
                throw new Error('Recipient E2EE is not enabled');
            }
            publicKey = status.public_key;
        }

        return encryptMessage({
            plaintext: content,
            senderUserId: currentUser.id,
            recipientUserId: recipientId,
            senderBundle: e2eeState.localKey,
            recipientPublicKeyBase64: publicKey,
        });
    }, [currentUser?.id, e2eeState.localKey, e2eeState.selfEnabled]);

    const encryptCurrentChatContent = useCallback(async (content: string) => {
        if (!content) {
            return undefined;
        }
        if (e2eeState.loading) {
            throw new Error('E2EE is not ready for this conversation');
        }
        if (e2eeState.selfEnabled && !e2eeReady) {
            throw new Error('E2EE is not ready for this conversation');
        }
        if (!e2eeReady) {
            return undefined;
        }
        return encryptContentForRecipient(content, Number(userId), e2eeState.recipientPublicKey);
    }, [e2eeReady, e2eeState.loading, e2eeState.recipientPublicKey, e2eeState.selfEnabled, encryptContentForRecipient, userId]);

    const recipientPublicKeyForUser = useCallback(async (recipientId: number) => {
        if (recipientId === Number(userId) && e2eeState.recipientPublicKey) {
            return e2eeState.recipientPublicKey;
        }

        const status = await e2eeService.getStatus(recipientId);
        if (!status.enabled || !status.public_key) {
            throw new Error('Recipient E2EE is not enabled');
        }
        return status.public_key;
    }, [e2eeState.recipientPublicKey, userId]);

    const encryptAndUploadAttachment = useCallback(async (
        file: File,
        fileType: AttachmentFileType,
        recipientId: number,
        options: {
            width?: number;
            height?: number;
            durationSeconds?: number;
        } = {},
    ): Promise<MessageAttachment> => {
        if (!currentUser?.id || !e2eeState.localKey) {
            throw new Error('E2EE is not ready for this conversation');
        }

        let width = options.width;
        let height = options.height;
        if (fileType === 'image' && (!width || !height)) {
            const dimensions = await imageDimensions(file);
            width = dimensions.width;
            height = dimensions.height;
        }

        const recipientPublicKey = await recipientPublicKeyForUser(recipientId);
        const encrypted = await encryptAttachmentForUpload({
            file,
            fileType,
            senderUserId: currentUser.id,
            recipientUserId: recipientId,
            senderBundle: e2eeState.localKey,
            recipientPublicKeyBase64: recipientPublicKey,
            width,
            height,
            durationSeconds: options.durationSeconds,
        });

        if (fileType === 'voice') {
            const attachment = await messageService.uploadVoice(encrypted.encryptedFile, options.durationSeconds || 0, encrypted.fields);
            return withDecryptedAttachmentPreview(attachment, file, encrypted.metadata, encrypted.fields);
        }
        if (fileType === 'video_note') {
            const attachment = await messageService.uploadVideoNote(encrypted.encryptedFile, options.durationSeconds || 0, encrypted.fields);
            return withDecryptedAttachmentPreview(attachment, file, encrypted.metadata, encrypted.fields);
        }
        if (fileType === 'video' || fileType === 'audio' || fileType === 'file') {
            const attachment = await messageService.uploadAttachment(encrypted.encryptedFile, fileType, encrypted.fields);
            return withDecryptedAttachmentPreview(attachment, file, encrypted.metadata, encrypted.fields);
        }

        const attachment = await messageService.uploadImage(encrypted.encryptedFile, {
            ...encrypted.fields,
            width,
            height,
        });
        return withDecryptedAttachmentPreview(attachment, file, encrypted.metadata, encrypted.fields);
    }, [currentUser?.id, e2eeState.localKey, recipientPublicKeyForUser]);

    const uploadForwardedAttachments = useCallback(async (
        attachments: MessageAttachment[],
        recipientId: number,
    ): Promise<MessageAttachment[]> => {
        const uploaded: MessageAttachment[] = [];
        for (const attachment of attachments) {
            const file = await fileFromRemoteAttachment(attachment);
            uploaded.push(await encryptAndUploadAttachment(file, attachment.file_type, recipientId, {
                width: attachment.width,
                height: attachment.height,
                durationSeconds: attachment.duration_seconds ?? attachment.duration,
            }));
        }
        return uploaded;
    }, [encryptAndUploadAttachment]);

    const handleSocketMessageDeleted = useCallback((messageId: number) => {
        setMessages(prev => prev.filter(message => message.id !== messageId));
        setPinnedMessage(prev => prev?.message_id === messageId ? null : prev);
    }, [setMessages]);

    const handleSocketMessageUpdated = useCallback((message: Message) => {
        void decryptIncomingMessage(message).then(displayMessage => {
            applyMessageUpdate(displayMessage);
            setPinnedMessage(prev => (
                prev?.message_id === displayMessage.id
                    ? { ...prev, message: displayMessage }
                    : prev
            ));
        });
    }, [applyMessageUpdate, decryptIncomingMessage]);

    const handleSocketMessageUnpinned = useCallback(() => {
        setPinnedMessage(null);
    }, []);

    const handleSocketMessagePinned = useCallback((pin: PinnedMessage) => {
        void decryptIncomingMessage(pin.message).then(message => {
            setPinnedMessage({ ...pin, message });
        });
    }, [decryptIncomingMessage]);

    useChatWebSocket({
        userId,
        currentUserId: currentUser?.id,
        onTyping: setOtherTyping,
        onMessageDeleted: handleSocketMessageDeleted,
        onReadReceipt: markAsRead,
        onConversationRead: markAsRead,
        onNewMessage: useCallback((msg) => {
            void decryptIncomingMessage(msg).then(displayMessage => {
                setMessages(prev => {
                    const exists = prev.some(m => m.id === msg.id);
                    if (exists) return prev;
                    const optimisticIndex = prev.findIndex(m =>
                        m.id >= optimisticMessageFloor &&
                        m.from_id === displayMessage.from_id &&
                        m.to_id === displayMessage.to_id &&
                        messagesMatchOptimistic(m, displayMessage)
                    );
                    if (optimisticIndex !== -1) {
                        return prev.map((m, index) => index === optimisticIndex ? displayMessage : m);
                    }
                    return [...prev, displayMessage];
                });
                if (displayMessage.from_id === Number(userId)) {
                    wsService.sendReadReceipt(Number(userId));
                    markAsRead(Number(userId));
                }
            });
        }, [decryptIncomingMessage, markAsRead, setMessages, userId, wsService]),
        onMessageUpdated: handleSocketMessageUpdated,
        onMessagePinned: handleSocketMessagePinned,
        onMessageUnpinned: handleSocketMessageUnpinned,
    });

    useEffect(() => {
        let cancelled = false;
        setE2eeState(prev => ({ ...prev, loading: true }));

        if (!currentUser?.id || !userId) {
            setE2eeState({
                loading: false,
                selfEnabled: false,
                recipientEnabled: false,
                recipientPublicKey: '',
                localKey: null,
            });
            return () => {
                cancelled = true;
            };
        }

        Promise.all([
            e2eeService.getStatus(),
            e2eeService.getStatus(Number(userId)),
            getLocalE2EEKeyBundle(currentUser.id),
        ]).then(([selfStatus, recipientStatus, localKey]) => {
            if (cancelled) {
                return;
            }
            setE2eeState({
                loading: false,
                selfEnabled: selfStatus.enabled,
                recipientEnabled: recipientStatus.enabled,
                recipientPublicKey: recipientStatus.public_key || '',
                localKey,
            });
        }).catch(() => {
            if (cancelled) {
                return;
            }
            setE2eeState(prev => ({
                ...prev,
                loading: false,
                recipientEnabled: false,
                recipientPublicKey: '',
            }));
        });

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, userId]);

    useEffect(() => {
        const refreshLocalKey = () => {
            if (!currentUser?.id) {
                return;
            }

            void getLocalE2EEKeyBundle(currentUser.id).then(localKey => {
                setE2eeState(prev => ({ ...prev, localKey }));
            });
        };

        window.addEventListener('e2ee:local-key-changed', refreshLocalKey);
        return () => window.removeEventListener('e2ee:local-key-changed', refreshLocalKey);
    }, [currentUser?.id]);

    useEffect(() => {
        loadInitial();
        if (userId) {
            userService.getUser(userId).then(setRecipient).catch(console.error);
        }
    }, [loadInitial, userId]);

    useEffect(() => {
        const conversationId = Number(userId);
        if (!conversationId) {
            return;
        }

        const syncActiveConversation = () => {
            if (document.visibilityState === 'visible' && document.hasFocus()) {
                wsService.setActiveConversation(conversationId);
            } else {
                wsService.clearActiveConversation();
            }
        };

        syncActiveConversation();
        document.addEventListener('visibilitychange', syncActiveConversation);
        window.addEventListener('focus', syncActiveConversation);
        window.addEventListener('blur', syncActiveConversation);

        return () => {
            document.removeEventListener('visibilitychange', syncActiveConversation);
            window.removeEventListener('focus', syncActiveConversation);
            window.removeEventListener('blur', syncActiveConversation);
            wsService.clearActiveConversation();
        };
    }, [userId, wsService]);

    useEffect(() => {
        if (!userId) return;
        wsService.sendReadReceipt(Number(userId));
        markAsRead(Number(userId));
    }, [markAsRead, userId, wsService]);

    useEffect(() => {
        let cancelled = false;
        setPinnedMessage(null);

        if (!userId) {
            return () => {
                cancelled = true;
            };
        }

        messageService.getPinnedMessage(Number(userId))
            .then(async pin => {
                const nextPin = pin?.message ? {
                    ...pin,
                    message: await decryptIncomingMessage(pin.message),
                } : pin;
                if (!cancelled) {
                    setPinnedMessage(nextPin);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    console.error(error);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [decryptIncomingMessage, userId]);

    const uploadAttachments = useCallback(async (files: File[]): Promise<MessageAttachment[]> => {
        if (!files.length) return [];

        const validationError = validateChatAttachments(files);
        if (validationError) {
            throw new Error(validationError);
        }
        if (e2eeState.selfEnabled && !e2eeReady) {
            throw new Error('E2EE is not ready for this conversation');
        }

        const attachments: MessageAttachment[] = [];

        for (const [index, file] of files.entries()) {
            const fileType = attachmentKindFromFile(file);
            setSendStatus(`Подготавливаем вложение ${index + 1} из ${files.length}`);
            const uploadFile = await prepareFileForUpload(file, fileType);
            const dimensions = await dimensionsForUpload(uploadFile, fileType);
            setSendStatus(`Загружаем вложение ${index + 1} из ${files.length}`);
            if (e2eeReady) {
                attachments.push(await encryptAndUploadAttachment(uploadFile, fileType, Number(userId), dimensions));
            } else {
                attachments.push(await messageService.uploadAttachment(uploadFile, fileType));
            }
        }

        return attachments;
    }, [e2eeReady, e2eeState.selfEnabled, encryptAndUploadAttachment, userId]);

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
            .filter(message => message.id > 0 && message.id < 10000000)
            .map(message => message.id);
        if (!realIds.length) {
            await dialog.alert({
                title: 'Нельзя удалить сообщения',
                message: 'Ещё не отправленные сообщения нельзя удалить пакетно.',
                confirmText: 'Понятно',
                icon: 'warning',
            });
            return;
        }

        const ok = await dialog.confirm({
            title: 'Удалить у себя?',
            message: 'Выбранные сообщения исчезнут только в вашем чате.',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'danger',
        });
        if (!ok) return;

        try {
            await messageService.deleteMessagesBatch(realIds, 'for_me');
            setMessages(prev => prev.filter(m => !realIds.includes(m.id)));
            setPinnedMessage(prev => prev && realIds.includes(prev.message_id) ? null : prev);
            exitSelectionMode();
        } catch (error) {
            console.error(error);
            await dialog.alert({
                title: 'Не удалось удалить сообщения',
                message: 'Попробуйте повторить действие позже.',
                confirmText: 'Понятно',
                icon: 'danger',
            });
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
            setSendStatus(files.length ? 'Подготавливаем вложения' : 'Отправляем сообщение');
            const encryption = await encryptCurrentChatContent(content);
            const attachments = await uploadAttachments(files);
            setSendStatus('Отправляем сообщение');

            const tempMessage: Message = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                encryption_version: encryption?.encryption_version ?? 0,
                ciphertext: encryption?.ciphertext,
                nonce: encryption?.nonce,
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
            wsService.send(Number(userId), encryption ? '' : content, attachments.map(attachmentForTransport), replyToMessage?.id, encryption);
            forceScrollToBottom();
            setNewMessage('');
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(error instanceof Error && error.message === 'E2EE is not ready for this conversation'
                ? 'Сквозное шифрование недоступно: восстановите ключ или попросите собеседника включить E2EE'
                : getUploadErrorMessage(error, 'Не удалось отправить сообщение'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, encryptCurrentChatContent, forceScrollToBottom, newMessage, replyToMessage, sendMessageToStore, uploadAttachments, userId, wsService]);

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
            const content = (text ?? '').trim();
            const encryption = await encryptCurrentChatContent(content);
            if (e2eeState.selfEnabled && !e2eeReady) {
                throw new Error('E2EE is not ready for this conversation');
            }
            const attachment = e2eeReady
                ? await encryptAndUploadAttachment(file, 'voice', Number(userId), { durationSeconds })
                : await messageService.uploadVoice(file, durationSeconds);
            const attachments = [attachment];
            setSendStatus('Отправляем голосовое сообщение');

            const tempMessage: Message = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                encryption_version: encryption?.encryption_version ?? 0,
                ciphertext: encryption?.ciphertext,
                nonce: encryption?.nonce,
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
            wsService.send(Number(userId), encryption ? '' : content, attachments.map(attachmentForTransport), replyToMessage?.id, encryption);
            forceScrollToBottom();
            if (content) {
                setNewMessage('');
            }
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(error instanceof Error && error.message === 'E2EE is not ready for this conversation'
                ? 'Сквозное шифрование недоступно: восстановите ключ или попросите собеседника включить E2EE'
                : getUploadErrorMessage(error, 'Не удалось отправить голосовое сообщение'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, e2eeReady, e2eeState.selfEnabled, encryptAndUploadAttachment, encryptCurrentChatContent, forceScrollToBottom, replyToMessage, sendMessageToStore, userId, wsService]);

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
            setSendStatus('Загружаем кружок');
            const content = (text ?? '').trim();
            const encryption = await encryptCurrentChatContent(content);
            if (e2eeState.selfEnabled && !e2eeReady) {
                throw new Error('E2EE is not ready for this conversation');
            }
            const attachment = e2eeReady
                ? await encryptAndUploadAttachment(file, 'video_note', Number(userId), { durationSeconds })
                : await messageService.uploadVideoNote(file, durationSeconds);
            const attachments = [attachment];
            setSendStatus('Отправляем кружок');

            const tempMessage: Message = {
                id: Date.now(),
                from_id: currentUser?.id || 0,
                to_id: Number(userId),
                content,
                encryption_version: encryption?.encryption_version ?? 0,
                ciphertext: encryption?.ciphertext,
                nonce: encryption?.nonce,
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
            wsService.send(Number(userId), encryption ? '' : content, attachments.map(attachmentForTransport), replyToMessage?.id, encryption);
            forceScrollToBottom();
            if (content) {
                setNewMessage('');
            }
            setReplyToMessage(null);
            return true;
        } catch (error) {
            console.error(error);
            setUploadError(error instanceof Error && error.message === 'E2EE is not ready for this conversation'
                ? 'Сквозное шифрование недоступно: восстановите ключ или попросите собеседника включить E2EE'
                : getUploadErrorMessage(error, 'Не удалось отправить кружок'));
            return false;
        } finally {
            setSendStatus('');
        }
    }, [currentUser, e2eeReady, e2eeState.selfEnabled, encryptAndUploadAttachment, encryptCurrentChatContent, forceScrollToBottom, replyToMessage, sendMessageToStore, userId, wsService]);

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

    const openUserProfile = useCallback((profileUserId: number) => {
        navigate(`/users/${profileUserId}`);
    }, [navigate]);

    const saveEditedMessage = useCallback(async (messageId: number, content: string) => {
        const existingMessage = messages.find(message => message.id === messageId);
        const shouldEncryptEdit = Boolean(
            existingMessage &&
            ((existingMessage.encryption_version ?? 0) > 0 || e2eeState.selfEnabled)
        );

        if (shouldEncryptEdit && existingMessage) {
            if (existingMessage.decryption_error) {
                setUploadError('Нельзя редактировать сообщение, которое не удалось расшифровать');
                return;
            }
            if (e2eeState.selfEnabled && !e2eeReady) {
                setUploadError('Сквозное шифрование недоступно для редактирования сообщения');
                return;
            }

            const recipientId = existingMessage.to_id === currentUser?.id
                ? existingMessage.from_id
                : existingMessage.to_id;
            const recipientPublicKey = recipientId === Number(userId) ? e2eeState.recipientPublicKey : undefined;
            const encryption = await encryptContentForRecipient(content.trim(), recipientId, recipientPublicKey);
            if (!encryption) {
                setUploadError('Сквозное шифрование недоступно для редактирования сообщения');
                return;
            }

            const updated = await messageService.updateMessage(messageId, '', encryption);
            const displayMessage = await decryptIncomingMessage(updated);
            applyMessageUpdate(displayMessage);
            setEditingMessageId(null);
            setEditContent('');
            return;
        }

        await updateMessage(messageId, content);
        setEditingMessageId(null);
        setEditContent('');
    }, [
        applyMessageUpdate,
        currentUser?.id,
        decryptIncomingMessage,
        e2eeReady,
        e2eeState.recipientPublicKey,
        e2eeState.selfEnabled,
        encryptContentForRecipient,
        messages,
        setEditContent,
        setEditingMessageId,
        updateMessage,
        userId,
    ]);

    const deleteChatMessage = useCallback(async (messageId: number, mode: MessageDeleteMode) => {
        await deleteMessage(messageId, mode);
        setPinnedMessage(prev => prev?.message_id === messageId ? null : prev);
    }, [deleteMessage]);

    const pinChatMessage = useCallback(async (message: Message) => {
        if (!userId) {
            return;
        }

        try {
            const pin = await messageService.pinMessage(Number(userId), message.id);
            setPinnedMessage({
                ...pin,
                message: await decryptIncomingMessage(pin.message),
            });
        } catch (error) {
            console.error(error);
            await dialog.alert({
                title: 'Не удалось закрепить сообщение',
                message: 'Проверьте, что сообщение не удалено, и попробуйте снова.',
                confirmText: 'Понятно',
                icon: 'warning',
            });
        }
    }, [decryptIncomingMessage, dialog, userId]);

    const unpinChatMessage = useCallback(async () => {
        if (!userId) {
            return;
        }

        try {
            await messageService.unpinMessage(Number(userId));
            setPinnedMessage(null);
        } catch (error) {
            console.error(error);
            await dialog.alert({
                title: 'Не удалось открепить сообщение',
                message: 'Попробуйте повторить действие позже.',
                confirmText: 'Понятно',
                icon: 'warning',
            });
        }
    }, [dialog, userId]);

    const scrollToPinnedMessage = useCallback(async () => {
        if (!pinnedMessage) {
            return;
        }

        const targetMessageId = pinnedMessage.message_id;
        const isLoaded = messages.some(message => message.id === targetMessageId);

        if (!isLoaded) {
            const loaded = await loadUntilMessage(targetMessageId);
            if (!loaded) {
                return;
            }
        }

        setScrollToMessageRequest({
            messageId: targetMessageId,
            requestId: Date.now(),
        });
    }, [loadUntilMessage, messages, pinnedMessage]);

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
            const forwardAttachments = forwardMessage.attachments || [];
            const hasEncryptedAttachments = forwardAttachments.some(attachment => isEncryptedAttachment(attachment));
            const requiresClientEncryption = (forwardMessage.encryption_version ?? 0) > 0 || hasEncryptedAttachments;

            if (requiresClientEncryption) {
                const content = forwardMessage.content.trim();
                const encryptedContentRequired = (forwardMessage.encryption_version ?? 0) > 0;
                if (forwardMessage.decryption_error || (encryptedContentRequired && !content)) {
                    setForwardError('Нельзя переслать сообщение, которое не удалось расшифровать');
                    return;
                }
                if (forwardAttachments.some(attachment => attachment.decryption_error)) {
                    setForwardError('Нельзя переслать вложение, которое не удалось расшифровать');
                    return;
                }

                const encryptedMessages = [];
                for (const recipientId of Array.from(forwardSelectedIds)) {
                    const encryption = content
                        ? await encryptContentForRecipient(content, recipientId)
                        : undefined;
                    if (encryptedContentRequired && !encryption) {
                        throw new Error('E2EE is not ready for forward recipient');
                    }
                    const attachments = forwardAttachments.length
                        ? await uploadForwardedAttachments(forwardAttachments, recipientId)
                        : [];
                    encryptedMessages.push({
                        toUserId: recipientId,
                        ...(encryption || {}),
                        attachments: attachments.map(attachmentForTransport),
                    });
                }
                const forwardedRaw = await messageService.forwardEncryptedMessage(forwardMessage.id, encryptedMessages);
                const forwarded = await Promise.all(forwardedRaw.map(message => decryptIncomingMessage(message)));

                const hasForwardedForCurrentChat = forwarded.some(message =>
                    message.from_id === Number(userId) || message.to_id === Number(userId)
                );
                setMessages(prev => {
                    const existingIds = new Set(prev.map(message => message.id));
                    const currentChatMessages = forwarded.filter(message =>
                        !existingIds.has(message.id) &&
                        (message.from_id === Number(userId) || message.to_id === Number(userId))
                    );

                    return currentChatMessages.length ? [...prev, ...currentChatMessages] : prev;
                });
                if (hasForwardedForCurrentChat) {
                    forceScrollToBottom();
                }
                setForwardMessage(null);
                setForwardSelectedIds(new Set());
                return;
            }

            const forwarded = await messageService.forwardMessage(forwardMessage.id, Array.from(forwardSelectedIds));
            const hasForwardedForCurrentChat = forwarded.some(message =>
                message.from_id === Number(userId) || message.to_id === Number(userId)
            );
            setMessages(prev => {
                const existingIds = new Set(prev.map(message => message.id));
                const currentChatMessages = forwarded.filter(message =>
                    !existingIds.has(message.id) &&
                    (message.from_id === Number(userId) || message.to_id === Number(userId))
                );

                return currentChatMessages.length ? [...prev, ...currentChatMessages] : prev;
            });
            if (hasForwardedForCurrentChat) {
                forceScrollToBottom();
            }
            setForwardMessage(null);
            setForwardSelectedIds(new Set());
        } catch (error) {
            console.error(error);
            setForwardError('Не удалось переслать сообщение. Проверьте, что у получателя включено E2EE.');
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

    const resetDragState = useCallback(() => {
        dragDepthRef.current = 0;
        setDraggingFile(false);
    }, []);

    useEffect(() => {
        if (!draggingFile) {
            return;
        }

        const handleCancel = () => resetDragState();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                resetDragState();
            }
        };

        window.addEventListener('dragend', handleCancel);
        window.addEventListener('drop', handleCancel);
        window.addEventListener('blur', handleCancel);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('dragend', handleCancel);
            window.removeEventListener('drop', handleCancel);
            window.removeEventListener('blur', handleCancel);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [draggingFile, resetDragState]);

    const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        dragDepthRef.current += 1;

        setDraggingFile(true);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';

        setDraggingFile(true);
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (!dataTransferHasFiles(event.dataTransfer) && dragDepthRef.current === 0) {
            return;
        }

        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

        if (dragDepthRef.current === 0) {
            setDraggingFile(false);
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
        const files = filesFromDataTransfer(event.clipboardData);

        if (!files.length) {
            return;
        }

        event.preventDefault();
        queueFilesForPreview(files);
    };

    if (initialLoading) return <div className="flex h-full items-center justify-center sm:h-[calc(100vh-120px)]"><Spinner /></div>;

    return (
        <div
            className="relative flex h-full flex-col overflow-hidden bg-[var(--app-chat-bg)] sm:h-[calc(100vh-120px)] sm:rounded-2xl sm:border sm:border-gray-200/80"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
        >
            {draggingFile && (
                <div className="chat-drop-overlay">
                    <div className="chat-drop-overlay__card">
                        <span className="chat-drop-overlay__icon" aria-hidden="true">
                            <Icon name="paperclip" className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <p className="chat-drop-overlay__title">
                                Отпустите файлы для отправки
                            </p>
                            <p className="chat-drop-overlay__text">
                                Перед отправкой появится предпросмотр
                            </p>
                        </div>
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
                onDeleteClick={handleBatchDelete}
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
                onOpenRecipient={openUserProfile}
                recipientLastSeenAt={recipient?.last_seen_at}
            />
            {e2eeReady && (
                <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700 sm:px-4">
                    Сообщения защищены сквозным шифрованием
                </div>
            )}
            {!e2eeReady && e2eeState.selfEnabled && !e2eeState.loading && (
                <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 sm:px-4">
                    Сквозное шифрование включено, но для этого диалога недоступно. Текстовые сообщения не будут отправлены без E2EE.
                </div>
            )}
            <PinnedMessageBanner
                pinnedMessage={pinnedMessage}
                onClick={scrollToPinnedMessage}
                onUnpin={unpinChatMessage}
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
                onPinMessage={pinChatMessage}
                onUnpinMessage={unpinChatMessage}
                pinnedMessageId={pinnedMessage?.message_id ?? null}
                onEditMessage={(id, content) => {
                    setEditingMessageId(id);
                    setEditContent(content);
                }}
                onDeleteMessage={deleteChatMessage}
                editingMessageId={editingMessageId}
                editContent={editContent}
                setEditContent={setEditContent}
                onSaveEdit={saveEditedMessage}
                onCancelEdit={() => setEditingMessageId(null)}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                onScroll={handleScroll}
                messagesEndRef={messagesEndRef}
                formatDate={formatMonthDayDate}
                formatTime={formatTime}
                onOpenUser={openUserProfile}
                scrollToMessageRequest={scrollToMessageRequest}
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
                onSendVoice={sendVoiceMessage}
                onSendVideoNote={sendVideoNoteMessage}
                errorMessage={uploadError}
                onErrorMessageChange={setUploadError}
                incomingFiles={incomingFiles}
                onIncomingFilesConsumed={() => setIncomingFiles(null)}
                sendStatus={sendStatus}
                replyPreview={replyPreview}
                onCancelReply={() => setReplyToMessage(null)}
                onComposerLayoutChange={scrollToBottomIfNeeded}
            />
            {forwardMessage && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                    <div className="app-card w-full max-w-md p-4 shadow-xl sm:p-5">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-gray-950">Переслать сообщение</h2>
                                <p className="truncate text-sm text-gray-500">{messagePreviewText(forwardMessage)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeForwardDialog}
                                disabled={forwardLoading}
                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100"
                                aria-label="Закрыть"
                            >
                                x
                            </button>
                        </div>

                        <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-100">
                            {forwardLoading && forwardFriends.length === 0 ? (
                                <div className="flex justify-center p-5"><Spinner size="sm" /></div>
                            ) : forwardFriends.length === 0 ? (
                                <div className="p-4 text-center text-sm text-gray-500">Нет доступных получателей</div>
                            ) : (
                                forwardFriends.map(friend => (
                                    <label key={friend.id} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 p-3 last:border-b-0 hover:bg-gray-50">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(friend.id && forwardSelectedIds.has(friend.id))}
                                            onChange={() => toggleForwardRecipient(friend.id)}
                                            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                                        />
                                        <Avatar
                                            name={friend.name}
                                            src={friend.avatar}
                                            positionX={friend.avatarPositionX}
                                            positionY={friend.avatarPositionY}
                                            scale={friend.avatarScale}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                                            {friend.name || 'Пользователь'}
                                        </span>
                                    </label>
                                ))
                            )}
                        </div>

                        {forwardError && (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {forwardError}
                            </div>
                        )}

                        <div className="mt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={submitForward}
                                disabled={forwardLoading || forwardSelectedIds.size === 0}
                                className="flex-1 rounded-xl bg-sky-600 px-4 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50"
                            >
                                {forwardLoading ? 'Отправляем...' : 'Переслать'}
                            </button>
                            <button
                                type="button"
                                onClick={closeForwardDialog}
                                disabled={forwardLoading}
                                className="flex-1 rounded-xl bg-gray-100 px-4 py-2 text-gray-800 transition hover:bg-gray-200 disabled:opacity-50"
                            >
                                Отмена
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Chat;
