import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactElement } from 'react';
import { Icon } from "@/shared/ui/Icon.js";
import EmojiPickerModule, { EmojiStyle, type EmojiClickData, type Props as EmojiPickerProps } from 'emoji-picker-react';
import {
    chatVoiceMaxDurationSeconds,
    chatVideoNoteMaxDurationSeconds,
    formatFileSize,
    formatDuration,
    imageFilesFromClipboard,
    validateChatImages,
} from "@/shared/utils/uploadValidation.js";
import { PreviewVoiceMessage } from "@/features/chat/components/PreviewVoiceMessage.js";
import { PreviewVideoNoteMessage } from "@/features/chat/components/PreviewVideoNoteMessage.js";

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

function supportedVideoNoteMimeType() {
    if (typeof MediaRecorder === 'undefined') {
        return '';
    }
    return videoNoteMimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function voiceFileType(mimeType: string) {
    return mimeType.split(';')[0] || mimeType;
}

function voiceFileExtension(mimeType: string) {
    return voiceFileType(mimeType) === 'audio/ogg' ? 'ogg' : 'webm';
}

function videoNoteFileType(mimeType: string) {
    return mimeType.split(';')[0] || mimeType;
}

function videoNoteFileExtension(mimeType: string) {
    const t = videoNoteFileType(mimeType);
    return t === 'video/mp4' ? 'mp4' : 'webm';
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
}: ChatInputProps) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const voiceChunksRef = useRef<Blob[]>([]);
    const voiceStreamRef = useRef<MediaStream | null>(null);
    const recordingStartedAtRef = useRef(0);
    const recordingTimerRef = useRef<number | null>(null);
    const recordingMaxTimerRef = useRef<number | null>(null);
    const pointerStartXRef = useRef(0);
    const pointerSlideRef = useRef(0);
    const pendingVoiceStopRef = useRef<{ shouldSend: boolean } | null>(null);

    // Video note recording (separate from voice)
    const videoRecorderRef = useRef<MediaRecorder | null>(null);
    const videoChunksRef = useRef<Blob[]>([]);
    const videoStreamRef = useRef<MediaStream | null>(null);
    const videoRecordingStartedAtRef = useRef(0);
    const videoRecordingTimerRef = useRef<number | null>(null);
    const videoRecordingMaxTimerRef = useRef<number | null>(null);
    const liveVideoPreviewRef = useRef<HTMLVideoElement>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const canSend = Boolean(value.trim()) || selectedFiles.length > 0;
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [sending, setSending] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingElapsed, setRecordingElapsed] = useState(0);
    const [recordingStopping, setRecordingStopping] = useState(false);
    const [isCancellingRecord, setIsCancellingRecord] = useState(false);

    const [isVideoRecording, setIsVideoRecording] = useState(false);
    const [videoRecordingElapsed, setVideoRecordingElapsed] = useState(0);
    const [videoRecordingStopping, setVideoRecordingStopping] = useState(false);

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

    useEffect(() => {
        const urls = selectedFiles.map(file => URL.createObjectURL(file));
        setPreviews(urls);

        return () => {
            urls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [selectedFiles]);

    // Attach live camera stream to preview video element during recording.
    // Must use srcObject (not src), keep muted+playsInline+autoPlay.
    useEffect(() => {
        if (!isVideoRecording) {
            return;
        }
        const videoEl = liveVideoPreviewRef.current;
        const stream = videoStreamRef.current;
        if (videoEl && stream) {
            if (videoEl.srcObject !== stream) {
                videoEl.srcObject = stream;
            }
            const p = videoEl.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => undefined);
            }
        }
        return () => {
            // srcObject cleared in stopVideoStream on stop/cancel/unmount
        };
    }, [isVideoRecording]);

    const addFiles = useCallback((files: File[], replace = false) => {
        if (!files.length) {
            return;
        }

        setSelectedFiles(prev => {
            const nextFiles = replace ? files : [...prev, ...files];
            const validationError = validateChatImages(nextFiles);

            if (validationError) {
                onErrorMessageChange?.(validationError);
                return replace ? [] : prev;
            }

            onErrorMessageChange?.('');
            return nextFiles;
        });
    }, [onErrorMessageChange]);

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
        if (!canSend || sending || isRecording || pendingVoice || pendingVideoNote) return;
        onErrorMessageChange?.('');
        setSending(true);
        const sent = await onSend(selectedFiles);
        setSending(false);

        if (!sent) {
            return;
        }

        setSelectedFiles([]);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSendPendingVoice = useCallback(async () => {
        if (!pendingVoice || sending || !onSendVoice) {
            return;
        }
        onErrorMessageChange?.('');
        const file = new File([pendingVoice.blob], `voice-message.${voiceFileExtension(pendingVoice.mimeType)}`, {
            type: pendingVoice.mimeType,
            lastModified: Date.now(),
        });

        setSending(true);
        try {
            // Pass current text as optional comment; sendVoice handler decides whether to include & clear it
            const sent = await onSendVoice(file, pendingVoice.durationSeconds, value);
            if (sent) {
                clearPendingVoice();
            }
        } finally {
            setSending(false);
        }
    }, [pendingVoice, sending, onSendVoice, onErrorMessageChange, value, clearPendingVoice]);

    const handleSendPendingVideoNote = useCallback(async () => {
        if (!pendingVideoNote || sending || !onSendVideoNote) {
            return;
        }
        onErrorMessageChange?.('');
        const file = new File([pendingVideoNote.blob], `video-note.${videoNoteFileExtension(pendingVideoNote.mimeType)}`, {
            type: pendingVideoNote.mimeType,
            lastModified: Date.now(),
        });

        setSending(true);
        try {
            const sent = await onSendVideoNote(file, pendingVideoNote.durationSeconds, value);
            if (sent) {
                clearPendingVideoNote();
            }
        } finally {
            setSending(false);
        }
    }, [pendingVideoNote, sending, onSendVideoNote, onErrorMessageChange, value, clearPendingVideoNote]);

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

    const clearVideoRecordingTimers = useCallback(() => {
        if (videoRecordingTimerRef.current !== null) {
            window.clearInterval(videoRecordingTimerRef.current);
            videoRecordingTimerRef.current = null;
        }
        if (videoRecordingMaxTimerRef.current !== null) {
            window.clearTimeout(videoRecordingMaxTimerRef.current);
            videoRecordingMaxTimerRef.current = null;
        }
    }, []);

    const stopVoiceStream = useCallback(() => {
        voiceStreamRef.current?.getTracks().forEach(track => track.stop());
        voiceStreamRef.current = null;
    }, []);

    const stopVideoStream = useCallback(() => {
        const stream = videoStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        videoStreamRef.current = null;
        // clear live preview video element srcObject to release camera
        const live = liveVideoPreviewRef.current;
        if (live) {
            live.srcObject = null;
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

    const stopVideoRecording = useCallback((commitToPreview: boolean) => {
        const recorder = videoRecorderRef.current;

        if (!recorder || recorder.state === 'inactive') {
            clearVideoRecordingTimers();
            stopVideoStream();
            setIsVideoRecording(false);
            setVideoRecordingStopping(false);
            setVideoRecordingElapsed(0);
            return;
        }

        setVideoRecordingStopping(true);
        clearVideoRecordingTimers();

        recorder.onstop = () => {
            const chunks = videoChunksRef.current;
            const durationSeconds = Math.ceil((Date.now() - videoRecordingStartedAtRef.current) / 1000);
            const mimeType = recorder.mimeType || supportedVideoNoteMimeType();

            videoRecorderRef.current = null;
            videoChunksRef.current = [];
            stopVideoStream();
            setIsVideoRecording(false);
            setVideoRecordingStopping(false);
            setVideoRecordingElapsed(0);

            if (!commitToPreview || durationSeconds < 1) {
                return;
            }
            if (!chunks.length) {
                onErrorMessageChange?.('Видео-сообщение пустое. Попробуйте записать ещё раз.');
                return;
            }

            const type = videoNoteFileType(mimeType);
            const blob = new Blob(chunks, { type });
            const objectUrl = URL.createObjectURL(blob);

            setPendingVideoNote(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return null;
            });

            setPendingVideoNote({
                blob,
                durationSeconds,
                size: blob.size,
                objectUrl,
                mimeType: type,
            });
        };

        recorder.stop();
    }, [clearVideoRecordingTimers, onErrorMessageChange, stopVideoStream]);

    const startRecording = useCallback(async () => {
        if (isRecording || sending || recordingStopping) {
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
        isRecording,
        onErrorMessageChange,
        recordingStopping,
        sending,
        stopRecording,
        stopVoiceStream,
    ]);

    const startVideoRecording = useCallback(async () => {
        if (isVideoRecording || sending || videoRecordingStopping) {
            return;
        }
        if (!onSendVideoNote) {
            onErrorMessageChange?.('Видео-сообщения недоступны.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            onErrorMessageChange?.('Браузер не поддерживает запись видео.');
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
            const recorder = new MediaRecorder(stream, { mimeType: mimeType });

            videoChunksRef.current = [];
            videoStreamRef.current = stream;
            videoRecorderRef.current = recorder;
            videoRecordingStartedAtRef.current = Date.now();

            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    videoChunksRef.current.push(event.data);
                }
            };
            recorder.onerror = () => {
                onErrorMessageChange?.('Не удалось записать видео-сообщение.');
                stopVideoRecording(false);
            };

            recorder.start();
            setIsVideoRecording(true);
            setVideoRecordingElapsed(0);
            videoRecordingTimerRef.current = window.setInterval(() => {
                setVideoRecordingElapsed(Math.floor((Date.now() - videoRecordingStartedAtRef.current) / 1000));
            }, 250);
            videoRecordingMaxTimerRef.current = window.setTimeout(() => {
                stopVideoRecording(true);
            }, chatVideoNoteMaxDurationSeconds * 1000);
        } catch {
            clearVideoRecordingTimers();
            stopVideoStream();
            onErrorMessageChange?.('Разрешите доступ к камере и микрофону, чтобы записать видео-сообщение.');
        }
    }, [
        clearVideoRecordingTimers,
        isVideoRecording,
        onErrorMessageChange,
        onSendVideoNote,
        sending,
        stopVideoRecording,
        stopVideoStream,
        videoRecordingStopping,
    ]);

    const handleMicPointerDown = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (isRecording || sending || recordingStopping || selectedFiles.length > 0 || pendingVoice) {
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
        [isRecording, sending, recordingStopping, selectedFiles.length, pendingVoice, startRecording],
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

            // video note cleanup
            clearVideoRecordingTimers();
            const vrec = videoRecorderRef.current;
            if (vrec && vrec.state !== 'inactive') {
                vrec.onstop = null;
                vrec.stop();
            }
            stopVideoStream();
            setPendingVideoNote(prev => {
                if (prev) URL.revokeObjectURL(prev.objectUrl);
                return null;
            });
        };
    }, [clearRecordingTimers, clearVideoRecordingTimers, stopVoiceStream, stopVideoStream]);

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = imageFilesFromClipboard(event.clipboardData);

        if (!files.length) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        addFiles(files);
    };

    return (
        <div className="border-t border-border bg-surface/95 p-3 backdrop-blur sm:p-4 glass-panel">
            {replyPreview && (
                <div className="mb-3 flex items-start gap-3 rounded-xl border border-primary/30 bg-surface-muted px-3 py-2">
                    <div className="min-w-0 flex-1 border-l-2 border-primary pl-3">
                        <p className="text-xs font-medium text-primary">Ответ на: {replyPreview.author}</p>
                        <p className="truncate text-sm text-text-secondary">{replyPreview.text}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancelReply}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface hover:text-text"
                        aria-label="Отменить ответ"
                        title="Отменить ответ"
                    >
                        <Icon name="close" className="h-4 w-4" />
                    </button>
                </div>
            )}
            {selectedFiles.length > 0 && (
                <div className="mb-3 rounded-xl border border-border bg-surface-muted p-2 shadow-app">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-text-secondary">
                            {selectedFiles.length === 1 ? '1 изображение' : `${selectedFiles.length} изображений`}
                        </span>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {selectedFiles.map((file, index) => (
                            <div key={`${file.name}-${file.lastModified}-${index}`} className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-surface">
                                <img
                                    src={previews[index]}
                                    alt={file.name || 'Изображение'}
                                    className="h-full w-full object-cover"
                                />

                                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] font-medium leading-none text-white">
                                    {formatFileSize(file.size)}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => removeFile(index)}
                                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white"
                                    aria-label="Убрать картинку"
                                    title="Убрать картинку"
                                >
                                    <Icon name="close" className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isRecording && (
                <div
                    className={`mb-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                        isCancellingRecord
                            ? 'border border-danger bg-danger-soft text-danger'
                            : 'border border-primary/30 bg-surface-muted text-primary'
                    }`}
                >
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
                    <span className="font-semibold">{formatDuration(recordingElapsed)}</span>
                    <span
                        className={`min-w-0 flex-1 truncate ${
                            isCancellingRecord ? 'text-danger font-medium' : 'text-primary'
                        }`}
                    >
                        {isCancellingRecord ? 'Отпустите, чтобы отменить' : 'Отпустите, чтобы завершить запись'}
                    </span>
                    <span
                        className={`text-[10px] sm:text-[11px] whitespace-nowrap ${
                            isCancellingRecord ? 'text-danger' : 'text-primary'
                        }`}
                    >
                        {isCancellingRecord ? 'Отменить' : 'Сдвиньте влево для отмены'}
                    </span>
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

            {isVideoRecording && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-surface-muted px-3 py-2 text-sm text-primary">
                    {/* compact round live camera preview */}
                    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full border border-primary/40 bg-black">
                        <video
                            ref={liveVideoPreviewRef}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                            autoPlay
                        />
                        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-danger animate-pulse" />
                    </div>
                    <span className="font-semibold">{formatDuration(videoRecordingElapsed)}</span>
                    <span className="min-w-0 flex-1 truncate text-primary">Запись видео-сообщения…</span>
                    <button
                        type="button"
                        onClick={() => stopVideoRecording(true)}
                        className="rounded bg-primary px-2 py-0.5 text-xs text-white"
                    >
                        Завершить
                    </button>
                    <span className="text-[10px] sm:text-[11px] whitespace-nowrap text-primary">Макс. 60 сек</span>
                </div>
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

            <div className="relative flex gap-1.5 sm:gap-2 items-end">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
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
                    disabled={isRecording || sending || !!pendingVoice || !!pendingVideoNote || isVideoRecording}
                    className="composer-button"
                    title="Прикрепить картинку"
                >
                    <Icon name="image" className="w-4 h-4" />
                </button>

                <button
                    type="button"
                    onClick={() => void startVideoRecording()}
                    disabled={isVideoRecording || sending || recordingStopping || !!pendingVoice || !!pendingVideoNote || selectedFiles.length > 0}
                    className={`composer-button ${isVideoRecording ? 'recording' : ''}`}
                    title={isVideoRecording ? 'Идёт запись видео-сообщения' : 'Записать видео-сообщение (кружок)'}
                    aria-label="Записать видео-сообщение"
                >
                    <Icon name="video" className="w-4 h-4" />
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
                    placeholder="Сообщение..."
                    rows={1}
                    className="app-input flex-1 px-3 py-2 text-sm leading-5 resize-none sm:px-4 sm:text-base sm:leading-6"
                    style={{
                        minHeight: '40px',
                        maxHeight: `${textareaMaxHeight}px`,
                    }}
                />
                <button
                    type="button"
                    onClick={() => setShowEmojiPicker(prev => !prev)}
                    disabled={isRecording}
                    className="composer-button text-base leading-none"
                    title="Эмодзи">
                    😊
                </button>
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
                <button
                    type="button"
                    onPointerDown={handleMicPointerDown}
                    onPointerMove={handleMicPointerMove}
                    onPointerUp={handleMicPointerEnd}
                    onPointerCancel={e => handleMicPointerEnd(e, true)}
                    onPointerLeave={handleMicPointerLeave}
                    disabled={selectedFiles.length > 0 || sending || recordingStopping || !!pendingVoice || !!pendingVideoNote || isVideoRecording}
                    className={`composer-button ${isRecording ? 'recording' : pendingVoice ? 'text-text-muted' : ''}`}
                    title={
                        isRecording
                            ? 'Удерживайте для записи, отпустите чтобы завершить, сдвиньте влево для отмены'
                            : pendingVoice || pendingVideoNote
                              ? 'Сначала отправьте или удалите записанное медиа'
                              : 'Записать голосовое (удерживайте)'
                    }
                    aria-label="Записать голосовое сообщение"
                >
                    {isRecording ? (
                        <Icon name="mic" className="w-4 h-4 animate-pulse" />
                    ) : pendingVoice ? (
                        <Icon name="micOff" className="w-4 h-4" />
                    ) : (
                        <Icon name="mic" className="w-4 h-4" />
                    )}
                </button>
                <button
                    onClick={() => void handleSend()}
                    disabled={!canSend || sending || isRecording || !!pendingVoice || !!pendingVideoNote}
                    className="composer-send"
                >
                    <Icon name="send" className="w-4 h-4" />
                </button>
            </div>
            {errorMessage && (
                <div className="mt-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                    {errorMessage}
                </div>
            )}
            {sendStatus && !errorMessage && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-surface-muted px-3 py-2 text-sm text-primary">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />
                    {sendStatus}
                </div>
            )}
        </div>
    );
};
