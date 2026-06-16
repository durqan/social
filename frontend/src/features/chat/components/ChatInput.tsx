import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactElement } from 'react';
import { Icon } from "@/shared/ui/Icon.js";
import EmojiPickerModule, { EmojiStyle, type EmojiClickData, type Props as EmojiPickerProps } from 'emoji-picker-react';
import {
    chatVideoNoteMaxDurationSeconds,
    chatVoiceMaxDurationSeconds,
    chatAttachmentAccept,
    chatAttachmentKindForFile,
    formatFileSize,
    formatDuration,
    filesFromDataTransfer,
    validateVideoNoteFile,
    validateChatAttachments,
    type ChatAttachmentKind,
} from "@/shared/utils/uploadValidation.js";
import { PreviewVoiceMessage } from "@/features/chat/components/PreviewVoiceMessage.js";
import { PreviewVideoNoteMessage } from "@/features/chat/components/PreviewVideoNoteMessage.js";
import { VideoNoteOrbit } from "@/features/chat/components/VideoNoteOrbit.js";

const EmojiPicker = EmojiPickerModule as unknown as (props: EmojiPickerProps) => ReactElement | null;
const textareaMaxHeight = 168;
const voiceMimeCandidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/ogg',
];
const videoNoteMimeCandidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
];

function supportedVoiceMimeType() {
    if (typeof MediaRecorder === 'undefined') {
        return '';
    }

    return voiceMimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function voiceFileType(mimeType: string) {
    return mimeType.split(';')[0] || mimeType;
}

function voiceFileExtension(mimeType: string) {
    return voiceFileType(mimeType) === 'audio/ogg' ? 'ogg' : 'webm';
}

function supportedVideoNoteMimeType() {
    if (typeof MediaRecorder === 'undefined') {
        return '';
    }

    return videoNoteMimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function videoNoteFileType(mimeType: string) {
    const baseType = mimeType.split(';')[0]?.trim().toLowerCase();
    return baseType === 'video/mp4' ? 'video/mp4' : 'video/webm';
}

function videoNoteFileExtension(mimeType: string) {
    return videoNoteFileType(mimeType) === 'video/mp4' ? 'mp4' : 'webm';
}

function attachmentKindTitle(kind: ChatAttachmentKind | null) {
    switch (kind) {
        case 'image':
            return 'Изображение';
        case 'video':
            return 'Видео';
        case 'audio':
            return 'Аудио';
        default:
            return 'Файл';
    }
}

function attachmentKindIcon(kind: ChatAttachmentKind | null): 'image' | 'video' | 'audio' | 'file' {
    switch (kind) {
        case 'image':
            return 'image';
        case 'video':
            return 'video';
        case 'audio':
            return 'audio';
        default:
            return 'file';
    }
}

interface ChatInputProps {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    onSend: (files?: File[]) => Promise<boolean> | boolean;
    onSendVoice?: (file: File, durationSeconds: number, text?: string) => Promise<boolean> | boolean;
    onSendVideoNote?: (file: File, durationSeconds: number, text?: string) => Promise<boolean> | boolean;
    errorMessage?: string;
    onErrorMessageChange?: (message: string) => void;
    incomingFiles?: {
        id: number;
        files: File[];
    } | null;
    onIncomingFilesConsumed?: () => void;
    sendStatus?: string;
    replyPreview?: {
        author: string;
        text: string;
    } | null;
    onCancelReply?: () => void;
    onComposerLayoutChange?: () => void;
}

export const ChatInput = ({
    value,
    onChange,
    onSend,
    onSendVoice,
    onSendVideoNote,
    errorMessage = '',
    onErrorMessageChange,
    incomingFiles,
    onIncomingFilesConsumed,
    sendStatus,
    replyPreview,
    onCancelReply,
    onComposerLayoutChange,
}: ChatInputProps) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const sendingRef = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const voiceChunksRef = useRef<Blob[]>([]);
    const voiceStreamRef = useRef<MediaStream | null>(null);
    const recordingStartedAtRef = useRef(0);
    const recordingTimerRef = useRef<number | null>(null);
    const recordingMaxTimerRef = useRef<number | null>(null);
    const pointerStartXRef = useRef(0);
    const pointerSlideRef = useRef(0);
    const pendingVoiceStopRef = useRef<{ shouldSend: boolean } | null>(null);
    const videoNoteRecorderRef = useRef<MediaRecorder | null>(null);
    const videoNoteChunksRef = useRef<Blob[]>([]);
    const videoNoteStreamRef = useRef<MediaStream | null>(null);
    const videoNotePreviewRef = useRef<HTMLVideoElement | null>(null);
    const videoNoteStartedAtRef = useRef(0);
    const videoNoteTimerRef = useRef<number | null>(null);
    const videoNoteMaxTimerRef = useRef<number | null>(null);
    const videoNoteMimeTypeRef = useRef('');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const canSend = Boolean(value.trim()) || selectedFiles.length > 0;
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [sending, setSending] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingElapsed, setRecordingElapsed] = useState(0);
    const [recordingStopping, setRecordingStopping] = useState(false);
    const [isCancellingRecord, setIsCancellingRecord] = useState(false);
    const [isVideoNoteRecording, setIsVideoNoteRecording] = useState(false);
    const [videoNoteElapsed, setVideoNoteElapsed] = useState(0);
    const [videoNoteStopping, setVideoNoteStopping] = useState(false);

    type PendingVoice = {
        blob: Blob;
        durationSeconds: number;
        size: number;
        objectUrl: string;
        mimeType: string;
    };
    const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null);

    type PendingVideoNote = {
        blob: Blob;
        durationSeconds: number;
        size: number;
        objectUrl: string;
        mimeType: string;
    };
    const [pendingVideoNote, setPendingVideoNote] = useState<PendingVideoNote | null>(null);
    const showCaptureActions = !canSend && !pendingVoice && !pendingVideoNote;

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;

        if (!textarea) {
            return;
        }

        textarea.style.height = 'auto';
        const nextHeight = Math.min(textarea.scrollHeight, textareaMaxHeight);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > textareaMaxHeight ? 'auto' : 'hidden';
    }, []);

    useLayoutEffect(() => {
        resizeTextarea();
    }, [resizeTextarea, value]);

    useLayoutEffect(() => {
        onComposerLayoutChange?.();
    });

    useEffect(() => {
        const urls = selectedFiles.map(file => URL.createObjectURL(file));
        setPreviews(urls);

        return () => {
            urls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [selectedFiles]);

    const addFiles = useCallback((files: File[], replace = false) => {
        if (!files.length) {
            return;
        }
        if (pendingVoice || pendingVideoNote || isRecording || isVideoNoteRecording) {
            onErrorMessageChange?.('Сначала отправьте или удалите записанное вложение.');
            return;
        }

        setSelectedFiles(prev => {
            const nextFiles = replace ? files : [...prev, ...files];
            const validationError = validateChatAttachments(nextFiles);

            if (validationError) {
                onErrorMessageChange?.(validationError);
                return prev;
            }

            onErrorMessageChange?.('');
            return nextFiles;
        });
    }, [isRecording, isVideoNoteRecording, onErrorMessageChange, pendingVideoNote, pendingVoice]);

    useEffect(() => {
        if (!incomingFiles) {
            return;
        }

        addFiles(incomingFiles.files);
        onIncomingFilesConsumed?.();
    }, [addFiles, incomingFiles, onIncomingFilesConsumed]);

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const clearPendingVoice = useCallback(() => {
        setPendingVoice(prev => {
            if (prev) {
                URL.revokeObjectURL(prev.objectUrl);
            }
            return null;
        });
    }, []);

    const clearPendingVideoNote = useCallback(() => {
        setPendingVideoNote(prev => {
            if (prev) {
                URL.revokeObjectURL(prev.objectUrl);
            }
            return null;
        });
    }, []);

    const handleSend = async () => {
        if (!canSend || sendingRef.current || isRecording || isVideoNoteRecording || pendingVoice || pendingVideoNote) return;
        onErrorMessageChange?.('');
        sendingRef.current = true;
        setSending(true);
        try {
            const sent = await onSend(selectedFiles);

            if (!sent) {
                return;
            }

            setSelectedFiles([]);

            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    const handleSendPendingVoice = useCallback(async () => {
        if (!pendingVoice || sendingRef.current || !onSendVoice) {
            return;
        }
        onErrorMessageChange?.('');
        const file = new File([pendingVoice.blob], `voice-message.${voiceFileExtension(pendingVoice.mimeType)}`, {
            type: pendingVoice.mimeType,
            lastModified: Date.now(),
        });

        sendingRef.current = true;
        setSending(true);
        try {
            // Pass current text as optional comment; sendVoice handler decides whether to include & clear it
            const sent = await onSendVoice(file, pendingVoice.durationSeconds, value);
            if (sent) {
                clearPendingVoice();
            }
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [pendingVoice, onSendVoice, onErrorMessageChange, value, clearPendingVoice]);

    const handleSendPendingVideoNote = useCallback(async () => {
        if (!pendingVideoNote || sendingRef.current || !onSendVideoNote) {
            return;
        }

        const type = videoNoteFileType(pendingVideoNote.blob.type || pendingVideoNote.mimeType);
        const file = new File([pendingVideoNote.blob], `video-note.${videoNoteFileExtension(type)}`, {
            type,
            lastModified: Date.now(),
        });

        const validationError = validateVideoNoteFile(file, pendingVideoNote.durationSeconds);
        if (validationError) {
            onErrorMessageChange?.(validationError);
            return;
        }

        onErrorMessageChange?.('');
        sendingRef.current = true;
        setSending(true);
        try {
            const sent = await onSendVideoNote(file, pendingVideoNote.durationSeconds, value);
            if (sent) {
                clearPendingVideoNote();
            }
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [pendingVideoNote, onSendVideoNote, onErrorMessageChange, value, clearPendingVideoNote]);

    const clearRecordingTimers = useCallback(() => {
        if (recordingTimerRef.current !== null) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        if (recordingMaxTimerRef.current !== null) {
            window.clearTimeout(recordingMaxTimerRef.current);
            recordingMaxTimerRef.current = null;
        }
    }, []);

    const stopVoiceStream = useCallback(() => {
        voiceStreamRef.current?.getTracks().forEach(track => track.stop());
        voiceStreamRef.current = null;
    }, []);

    const clearVideoNoteTimers = useCallback(() => {
        if (videoNoteTimerRef.current !== null) {
            window.clearInterval(videoNoteTimerRef.current);
            videoNoteTimerRef.current = null;
        }
        if (videoNoteMaxTimerRef.current !== null) {
            window.clearTimeout(videoNoteMaxTimerRef.current);
            videoNoteMaxTimerRef.current = null;
        }
    }, []);

    const stopVideoNoteStream = useCallback(() => {
        videoNoteStreamRef.current?.getTracks().forEach(track => track.stop());
        videoNoteStreamRef.current = null;
        if (videoNotePreviewRef.current) {
            videoNotePreviewRef.current.srcObject = null;
        }
    }, []);

    const stopRecording = useCallback((commitToPreview: boolean) => {
        const recorder = mediaRecorderRef.current;

        if (!recorder || recorder.state === 'inactive') {
            clearRecordingTimers();
            stopVoiceStream();
            setIsRecording(false);
            setRecordingStopping(false);
            setRecordingElapsed(0);
            setIsCancellingRecord(false);
            pendingVoiceStopRef.current = null;
            return;
        }

        setRecordingStopping(true);
        clearRecordingTimers();

        recorder.onstop = () => {
            const chunks = voiceChunksRef.current;
            const durationSeconds = Math.ceil((Date.now() - recordingStartedAtRef.current) / 1000);
            const mimeType = recorder.mimeType || supportedVoiceMimeType();

            mediaRecorderRef.current = null;
            voiceChunksRef.current = [];
            stopVoiceStream();
            setIsRecording(false);
            setRecordingStopping(false);
            setRecordingElapsed(0);
            setIsCancellingRecord(false);
            pendingVoiceStopRef.current = null;

            if (!commitToPreview || durationSeconds < 1) {
                // cancelled or too short: discard chunks (no upload)
                return;
            }
            if (!chunks.length) {
                onErrorMessageChange?.('Голосовое сообщение пустое. Попробуйте записать еще раз.');
                return;
            }

            const type = voiceFileType(mimeType);
            const blob = new Blob(chunks, { type });
            const objectUrl = URL.createObjectURL(blob);

            // Clear any previous preview
            setPendingVoice(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return null;
            });

            setPendingVoice({
                blob,
                durationSeconds,
                size: blob.size,
                objectUrl,
                mimeType: type,
            });
            // Do NOT call onSendVoice here. User must explicitly Send or Delete from preview.
        };

        recorder.stop();
    }, [clearRecordingTimers, onErrorMessageChange, stopVoiceStream]);

    const stopVideoNoteRecording = useCallback((commitToPreview: boolean) => {
        const recorder = videoNoteRecorderRef.current;

        if (!recorder || recorder.state === 'inactive') {
            clearVideoNoteTimers();
            stopVideoNoteStream();
            setIsVideoNoteRecording(false);
            setVideoNoteStopping(false);
            setVideoNoteElapsed(0);
            return;
        }

        setVideoNoteStopping(true);
        clearVideoNoteTimers();

        recorder.onstop = () => {
            const chunks = videoNoteChunksRef.current;
            const elapsedSeconds = Math.ceil((Date.now() - videoNoteStartedAtRef.current) / 1000);
            const durationSeconds = Math.min(chatVideoNoteMaxDurationSeconds, elapsedSeconds);
            const selectedMimeType = videoNoteMimeTypeRef.current || recorder.mimeType || supportedVideoNoteMimeType();
            const type = videoNoteFileType(recorder.mimeType || selectedMimeType);

            videoNoteRecorderRef.current = null;
            videoNoteChunksRef.current = [];
            videoNoteMimeTypeRef.current = '';
            stopVideoNoteStream();
            setIsVideoNoteRecording(false);
            setVideoNoteStopping(false);
            setVideoNoteElapsed(0);

            if (!commitToPreview || durationSeconds < 1) {
                return;
            }
            if (!chunks.length) {
                onErrorMessageChange?.('Видео-сообщение пустое. Попробуйте записать еще раз.');
                return;
            }

            const blob = new Blob(chunks, { type });
            const validationError = validateVideoNoteFile(
                new File([blob], `video-note.${videoNoteFileExtension(type)}`, {
                    type,
                    lastModified: Date.now(),
                }),
                durationSeconds,
            );
            if (validationError) {
                onErrorMessageChange?.(validationError);
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            setPendingVideoNote(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return {
                    blob,
                    durationSeconds,
                    size: blob.size,
                    objectUrl,
                    mimeType: type,
                };
            });
        };

        recorder.stop();
    }, [clearVideoNoteTimers, onErrorMessageChange, stopVideoNoteStream]);

    const startVideoNoteRecording = useCallback(async () => {
        if (isVideoNoteRecording || sending || videoNoteStopping || isRecording || pendingVoice || pendingVideoNote || selectedFiles.length > 0) {
            return;
        }
        if (!onSendVideoNote) {
            onErrorMessageChange?.('Кружки недоступны.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            onErrorMessageChange?.('Браузер не поддерживает запись видео-сообщений.');
            return;
        }

        const mimeType = supportedVideoNoteMimeType();
        if (!mimeType) {
            onErrorMessageChange?.('Браузер не поддерживает запись WebM/MP4 видео.');
            return;
        }

        try {
            onErrorMessageChange?.('');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: true,
            });
            videoNoteStreamRef.current = stream;
            const recorder = new MediaRecorder(stream, { mimeType });

            videoNoteChunksRef.current = [];
            videoNoteRecorderRef.current = recorder;
            videoNoteMimeTypeRef.current = mimeType;
            videoNoteStartedAtRef.current = Date.now();

            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    videoNoteChunksRef.current.push(event.data);
                }
            };
            recorder.onerror = () => {
                onErrorMessageChange?.('Не удалось записать кружок.');
                stopVideoNoteRecording(false);
            };

            recorder.start();
            setIsVideoNoteRecording(true);
            setVideoNoteElapsed(0);
            videoNoteTimerRef.current = window.setInterval(() => {
                setVideoNoteElapsed(Math.min(
                    chatVideoNoteMaxDurationSeconds,
                    Math.floor((Date.now() - videoNoteStartedAtRef.current) / 1000),
                ));
            }, 250);
            videoNoteMaxTimerRef.current = window.setTimeout(() => {
                stopVideoNoteRecording(true);
            }, chatVideoNoteMaxDurationSeconds * 1000);
        } catch {
            clearVideoNoteTimers();
            stopVideoNoteStream();
            onErrorMessageChange?.('Разрешите доступ к камере и микрофону, чтобы записать кружок.');
        }
    }, [
        clearVideoNoteTimers,
        isRecording,
        isVideoNoteRecording,
        onErrorMessageChange,
        onSendVideoNote,
        pendingVideoNote,
        pendingVoice,
        selectedFiles.length,
        sending,
        stopVideoNoteRecording,
        stopVideoNoteStream,
        videoNoteStopping,
    ]);

    const startRecording = useCallback(async () => {
        if (isRecording || sending || recordingStopping || isVideoNoteRecording || videoNoteStopping || pendingVideoNote) {
            return;
        }
        if (!onSendVoice) {
            onErrorMessageChange?.('Голосовые сообщения недоступны.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            onErrorMessageChange?.('Браузер не поддерживает запись голосовых сообщений.');
            return;
        }

        const mimeType = supportedVoiceMimeType();
        if (!mimeType) {
            onErrorMessageChange?.('Браузер не поддерживает запись WebM/Ogg аудио.');
            return;
        }

        try {
            onErrorMessageChange?.('');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType });

            voiceChunksRef.current = [];
            voiceStreamRef.current = stream;
            mediaRecorderRef.current = recorder;
            recordingStartedAtRef.current = Date.now();

            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    voiceChunksRef.current.push(event.data);
                }
            };
            recorder.onerror = () => {
                onErrorMessageChange?.('Не удалось записать голосовое сообщение.');
                stopRecording(false);
            };

            recorder.start();
            setIsRecording(true);
            setRecordingElapsed(0);
            setIsCancellingRecord(false);
            if (pendingVoiceStopRef.current) {
                const { shouldSend } = pendingVoiceStopRef.current;
                pendingVoiceStopRef.current = null;
                // stop shortly after recorder started
                window.setTimeout(() => stopRecording(shouldSend), 0);
            }
            recordingTimerRef.current = window.setInterval(() => {
                setRecordingElapsed(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
            }, 250);
            recordingMaxTimerRef.current = window.setTimeout(() => {
                stopRecording(true);
            }, chatVoiceMaxDurationSeconds * 1000);
        } catch {
            clearRecordingTimers();
            stopVoiceStream();
            setIsCancellingRecord(false);
            pendingVoiceStopRef.current = null;
            onErrorMessageChange?.('Разрешите доступ к микрофону, чтобы записать голосовое сообщение.');
        }
    }, [
        clearRecordingTimers,
        isVideoNoteRecording,
        isRecording,
        onErrorMessageChange,
        pendingVideoNote,
        recordingStopping,
        sending,
        stopRecording,
        stopVoiceStream,
        videoNoteStopping,
    ]);

    const handleMicPointerDown = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (isRecording || sending || recordingStopping || selectedFiles.length > 0 || pendingVoice || isVideoNoteRecording || videoNoteStopping || pendingVideoNote) {
                return;
            }
            if (e.pointerType === 'mouse' && e.button !== 0) {
                return;
            }
            e.preventDefault();
            pointerStartXRef.current = e.clientX;
            pointerSlideRef.current = 0;
            pendingVoiceStopRef.current = null;
            setIsCancellingRecord(false);
            startRecording();
            const target = e.currentTarget;
            if (target && typeof (target as any).setPointerCapture === 'function') {
                try {
                    (target as any).setPointerCapture(e.pointerId);
                } catch {
                    // capture not supported, fallback to other events if any
                }
            }
        },
        [isRecording, sending, recordingStopping, selectedFiles.length, pendingVoice, isVideoNoteRecording, videoNoteStopping, pendingVideoNote, startRecording],
    );

    const handleMicPointerMove = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (!isRecording || recordingStopping) {
                return;
            }
            const startX = pointerStartXRef.current;
            if (!startX) {
                return;
            }
            const dx = startX - e.clientX;
            const offset = Math.max(0, dx);
            pointerSlideRef.current = offset;
            const nextCancelling = offset > 80;
            if (nextCancelling !== isCancellingRecord) {
                setIsCancellingRecord(nextCancelling);
            }
        },
        [isRecording, recordingStopping, isCancellingRecord],
    );

    const handleMicPointerEnd = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>, forceCancel = false) => {
            const target = e.currentTarget;
            if (target && typeof (target as any).releasePointerCapture === 'function') {
                try {
                    (target as any).releasePointerCapture(e.pointerId);
                } catch {}
            }
            const slide = pointerSlideRef.current;
            pointerStartXRef.current = 0;
            pointerSlideRef.current = 0;
            setIsCancellingRecord(false);
            const shouldSend = !forceCancel && slide <= 80;
            if (!isRecording) {
                pendingVoiceStopRef.current = { shouldSend };
                return;
            }
            stopRecording(shouldSend);
        },
        [isRecording, stopRecording],
    );

    const handleMicPointerLeave = useCallback((_e: React.PointerEvent<HTMLButtonElement>) => {
        // Do not break recording state on leave (capture should deliver up if supported)
    }, []);

    useEffect(() => {
        const video = videoNotePreviewRef.current;
        const stream = videoNoteStreamRef.current;
        if (!isVideoNoteRecording || !video || !stream) {
            return;
        }

        video.srcObject = stream;
        void video.play().catch(() => {});

        return () => {
            if (video.srcObject === stream) {
                video.srcObject = null;
            }
        };
    }, [isVideoNoteRecording]);

    useEffect(() => {
        return () => {
            clearRecordingTimers();
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state !== 'inactive') {
                recorder.onstop = null;
                recorder.stop();
            }
            stopVoiceStream();
            setIsCancellingRecord(false);
            pendingVoiceStopRef.current = null;
            // revoke any unsent preview blob url
            setPendingVoice(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return null;
            });
            clearVideoNoteTimers();
            const videoRecorder = videoNoteRecorderRef.current;
            if (videoRecorder && videoRecorder.state !== 'inactive') {
                videoRecorder.onstop = null;
                videoRecorder.stop();
            }
            stopVideoNoteStream();
            setPendingVideoNote(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return null;
            });
        };
    }, [clearRecordingTimers, clearVideoNoteTimers, stopVideoNoteStream, stopVoiceStream]);

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = filesFromDataTransfer(event.clipboardData);

        if (!files.length) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        addFiles(files);
    };

    return (
        <div className="chat-composer-shell">
            {replyPreview && (
                <div className="chat-composer-context-bar">
                    <div className="chat-composer-context-bar__content">
                        <p className="chat-composer-context-bar__title">
                            Ответ <span className="chat-composer-context-bar__meta">{replyPreview.author}</span>
                        </p>
                        <p className="chat-composer-context-bar__text">{replyPreview.text}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancelReply}
                        className="chat-composer-context-bar__cancel"
                        aria-label="Отменить ответ"
                        title="Отменить ответ"
                    >
                        <Icon name="close" className="h-4 w-4" />
                    </button>
                </div>
            )}
            {selectedFiles.length > 0 && (
                <div className="chat-attachment-tray">
                    <div className="chat-attachment-tray__header">
                        <span>
                            {selectedFiles.length === 1 ? '1 вложение' : `${selectedFiles.length} вложений`}
                        </span>
                    </div>

                    <div className="chat-attachment-tray__list">
                        {selectedFiles.map((file, index) => {
                            const kind = chatAttachmentKindForFile(file);
                            const key = `${file.name}-${file.lastModified}-${index}`;

                            if (kind === 'image') {
                                return (
                                    <div key={key} className="chat-attachment-media-card">
                                        <img
                                            src={previews[index]}
                                            alt={file.name || 'Изображение'}
                                            className="chat-attachment-media-card__media"
                                        />

                                        <div className="chat-attachment-media-card__meta">
                                            {formatFileSize(file.size)}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => removeFile(index)}
                                            className="chat-attachment-remove"
                                            aria-label="Убрать вложение"
                                            title="Убрать вложение"
                                        >
                                            <Icon name="close" className="h-3 w-3" />
                                        </button>
                                    </div>
                                );
                            }

                            if (kind === 'video') {
                                return (
                                    <div key={key} className="chat-attachment-media-card chat-attachment-media-card--video">
                                        <video
                                            src={previews[index]}
                                            className="chat-attachment-media-card__media"
                                            muted
                                            playsInline
                                            preload="metadata"
                                        />

                                        <div className="chat-attachment-media-card__meta">
                                            <span className="chat-attachment-media-card__type">
                                                <Icon name="video" className="h-3 w-3" />
                                                {formatFileSize(file.size)}
                                            </span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => removeFile(index)}
                                            className="chat-attachment-remove"
                                            aria-label="Убрать вложение"
                                            title="Убрать вложение"
                                        >
                                            <Icon name="close" className="h-3 w-3" />
                                        </button>
                                    </div>
                                );
                            }

                            return (
                                <div key={key} className="chat-attachment-file-card">
                                    <span className="chat-attachment-file-card__icon">
                                        <Icon name={attachmentKindIcon(kind)} className="h-5 w-5" />
                                    </span>
                                    <span className="chat-attachment-file-card__body">
                                        <span className="chat-attachment-file-card__name">
                                            {file.name || attachmentKindTitle(kind)}
                                        </span>
                                        <span className="chat-attachment-file-card__meta">
                                            {attachmentKindTitle(kind)} · {formatFileSize(file.size)}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeFile(index)}
                                        className="chat-attachment-remove"
                                        aria-label="Убрать вложение"
                                        title="Убрать вложение"
                                    >
                                        <Icon name="close" className="h-3 w-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {isRecording && (
                <div
                    className={`mb-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                        isCancellingRecord
                            ? 'border border-red-200 bg-red-50 text-red-800'
                            : 'border border-sky-100 bg-sky-50 text-sky-800'
                    }`}
                >
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    <span className="font-semibold">{formatDuration(recordingElapsed)}</span>
                    <span
                        className={`min-w-0 flex-1 truncate ${
                            isCancellingRecord ? 'text-red-600 font-medium' : 'text-sky-700'
                        }`}
                    >
                        {isCancellingRecord ? 'Отпустите, чтобы отменить' : 'Отпустите, чтобы завершить запись'}
                    </span>
                    <span
                        className={`text-[10px] sm:text-[11px] whitespace-nowrap ${
                            isCancellingRecord ? 'text-red-500' : 'text-sky-600'
                        }`}
                    >
                        {isCancellingRecord ? 'Отменить' : 'Сдвиньте влево для отмены'}
                    </span>
                </div>
            )}

            {isVideoNoteRecording && (
                <div className="video-note-recording mb-3">
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <VideoNoteOrbit
                            isRecording
                            progressPercent={(videoNoteElapsed / chatVideoNoteMaxDurationSeconds) * 100}
                            timeLabel={`${formatDuration(videoNoteElapsed)} / ${formatDuration(chatVideoNoteMaxDurationSeconds)}`}
                            showControl={false}
                            title="Запись кружка"
                        >
                            <video
                                ref={videoNotePreviewRef}
                                autoPlay
                                muted
                                playsInline
                            />
                        </VideoNoteOrbit>
                        <div className="video-note-recording__panel min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-primary)]">
                                <span className="video-note-recording__dot" />
                                <span>Запись кружка</span>
                            </div>
                            <div className="mt-1 text-sm tabular-nums text-[var(--app-text-secondary)]">
                                {formatDuration(videoNoteElapsed)} / {formatDuration(chatVideoNoteMaxDurationSeconds)}
                            </div>
                            <button
                                type="button"
                                onClick={() => stopVideoNoteRecording(true)}
                                disabled={videoNoteStopping}
                                className="mt-3 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-700 active:bg-sky-800 disabled:opacity-50"
                            >
                                {videoNoteStopping ? 'Завершаем...' : 'Завершить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingVoice && (
                <PreviewVoiceMessage
                    src={pendingVoice.objectUrl}
                    durationSeconds={pendingVoice.durationSeconds}
                    sizeBytes={pendingVoice.size}
                    onDelete={() => {
                        clearPendingVoice();
                    }}
                    onSend={() => {
                        void handleSendPendingVoice();
                    }}
                    sending={sending}
                />
            )}

            {pendingVideoNote && (
                <PreviewVideoNoteMessage
                    src={pendingVideoNote.objectUrl}
                    durationSeconds={pendingVideoNote.durationSeconds}
                    sizeBytes={pendingVideoNote.size}
                    onDelete={() => {
                        clearPendingVideoNote();
                    }}
                    onSend={() => {
                        void handleSendPendingVideoNote();
                    }}
                    sending={sending}
                />
            )}

            <div className="chat-composer-pill">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={chatAttachmentAccept}
                    multiple
                    className="hidden"
                    onChange={e => {
                        const files = Array.from(e.target.files || []);
                        addFiles(files, true);
                        e.target.value = '';
                    }}
                />

                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || isVideoNoteRecording || sending || !!pendingVoice || !!pendingVideoNote}
                    className={`chat-composer-icon-button ${selectedFiles.length > 0 ? 'chat-composer-icon-button--active' : ''}`}
                    title="Прикрепить файл"
                    aria-label="Прикрепить файл"
                >
                    <Icon name="paperclip" className="h-5 w-5" />
                    {selectedFiles.length > 0 && (
                        <span className="chat-composer-badge" aria-hidden="true">
                            {selectedFiles.length}
                        </span>
                    )}
                </button>

                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={event => {
                        onChange(event);
                        requestAnimationFrame(resizeTextarea);
                    }}
                    onPaste={handlePaste}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                        }
                    }}
                    placeholder="Сообщение…"
                    rows={1}
                    className="chat-composer-textarea"
                />
                <div className="chat-composer-actions">
                    <button
                        type="button"
                        onClick={() => setShowEmojiPicker(prev => !prev)}
                        disabled={isRecording || isVideoNoteRecording}
                        className={`chat-composer-icon-button ${showEmojiPicker ? 'chat-composer-icon-button--active' : ''}`}
                        title="Эмодзи"
                        aria-label="Эмодзи"
                    >
                        <Icon name="smile" className="h-5 w-5" />
                    </button>
                    {showCaptureActions && (
                        <>
                            <button
                                type="button"
                                onPointerDown={handleMicPointerDown}
                                onPointerMove={handleMicPointerMove}
                                onPointerUp={handleMicPointerEnd}
                                onPointerCancel={e => handleMicPointerEnd(e, true)}
                                onPointerLeave={handleMicPointerLeave}
                                disabled={selectedFiles.length > 0 || sending || recordingStopping || !!pendingVoice || isVideoNoteRecording || videoNoteStopping || !!pendingVideoNote}
                                className={`chat-composer-icon-button ${isRecording ? 'recording' : pendingVoice ? 'text-gray-400' : ''}`}
                                title={
                                    isRecording
                                        ? 'Удерживайте для записи, отпустите чтобы завершить, сдвиньте влево для отмены'
                                        : pendingVoice
                                          ? 'Сначала отправьте или удалите записанное голосовое'
                                          : pendingVideoNote
                                            ? 'Сначала отправьте или удалите кружок'
                                            : 'Записать голосовое (удерживайте)'
                                }
                                aria-label="Записать голосовое сообщение"
                            >
                                {isRecording ? (
                                    <Icon name="mic" className="h-5 w-5 animate-pulse" />
                                ) : pendingVoice ? (
                                    <Icon name="micOff" className="h-5 w-5" />
                                ) : (
                                    <Icon name="mic" className="h-5 w-5" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => void startVideoNoteRecording()}
                                disabled={selectedFiles.length > 0 || sending || isRecording || recordingStopping || isVideoNoteRecording || videoNoteStopping || !!pendingVoice || !!pendingVideoNote}
                                className={`chat-composer-icon-button ${isVideoNoteRecording ? 'video-recording' : pendingVideoNote ? 'text-gray-400' : ''}`}
                                title={pendingVideoNote ? 'Сначала отправьте или удалите кружок' : 'Кружок'}
                                aria-label="Кружок"
                            >
                                <Icon name={pendingVideoNote ? 'videoOff' : 'video'} className="h-5 w-5" />
                            </button>
                        </>
                    )}
                    {canSend && (
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={sending || isRecording || isVideoNoteRecording || !!pendingVoice || !!pendingVideoNote}
                            className="chat-composer-send-button"
                            aria-label={sending ? 'Отправляем сообщение' : 'Отправить сообщение'}
                            title="Отправить"
                        >
                            {sending ? (
                                <span className="chat-composer-spinner" aria-hidden="true" />
                            ) : (
                                <Icon name="send" className="h-5 w-5" />
                            )}
                        </button>
                    )}
                </div>
                {showEmojiPicker && (
                    <div className="absolute bottom-16 right-4 z-50">
                        <EmojiPicker
                            width={300}
                            height={260}
                            emojiStyle={EmojiStyle.NATIVE}
                            searchDisabled
                            previewConfig={{
                                showPreview: false,
                            }}
                            onEmojiClick={(emoji: EmojiClickData) => {
                                onChange({
                                    target: {
                                        value: value + emoji.emoji,
                                    },
                                } as ChangeEvent<HTMLTextAreaElement>);

                                setShowEmojiPicker(false);
                            }}
                        />
                    </div>
                )}
            </div>
            {errorMessage && (
                <div className="chat-composer-feedback chat-composer-feedback--error">
                    {errorMessage}
                </div>
            )}
            {sendStatus && !errorMessage && (
                <div className="chat-composer-feedback chat-composer-feedback--status">
                    <span className="chat-composer-spinner" aria-hidden="true" />
                    {sendStatus}
                </div>
            )}
        </div>
    );
};
