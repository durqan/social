import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactElement } from 'react';
import { Icon } from "@/shared/ui/Icon.js";
import EmojiPickerModule, { EmojiStyle, type EmojiClickData, type Props as EmojiPickerProps } from 'emoji-picker-react';
import {
    formatFileSize,
    imageFilesFromClipboard,
    validateChatImages,
} from "@/shared/utils/uploadValidation.js";

const EmojiPicker = EmojiPickerModule as unknown as (props: EmojiPickerProps) => ReactElement | null;
const textareaMaxHeight = 168;

interface ChatInputProps {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    onSend: (files?: File[]) => Promise<boolean> | boolean;
    errorMessage?: string;
    onErrorMessageChange?: (message: string) => void;
    incomingFiles?: {
        id: number;
        files: File[];
    } | null;
    onIncomingFilesConsumed?: () => void;
    sendStatus?: string;
}

export const ChatInput = ({
    value,
    onChange,
    onSend,
    errorMessage = '',
    onErrorMessageChange,
    incomingFiles,
    onIncomingFilesConsumed,
    sendStatus,
}: ChatInputProps) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const canSend = Boolean(value.trim()) || selectedFiles.length > 0;
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [sending, setSending] = useState(false);

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

    const handleSend = async () => {
        if (!canSend || sending) return;
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
        <div className="border-t border-gray-200/80 bg-white/95 p-3 backdrop-blur sm:p-4">
            {selectedFiles.length > 0 && (
                <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-2 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-gray-600">
                            {selectedFiles.length === 1 ? '1 изображение' : `${selectedFiles.length} изображений`}
                        </span>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {selectedFiles.map((file, index) => (
                            <div key={`${file.name}-${file.lastModified}-${index}`} className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
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

            <div className="relative flex gap-2 items-end">
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
                    className="w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition flex items-center justify-center flex-shrink-0"
                    title="Прикрепить картинку"
                >
                    <Icon name="image" />
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
                    className="w-10 h-10 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition flex items-center justify-center flex-shrink-0"
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
                    onClick={() => void handleSend()}
                    disabled={!canSend || sending}
                    className="w-10 h-10 bg-sky-600 text-white rounded-full hover:bg-sky-700 transition disabled:opacity-50 flex items-center justify-center flex-shrink-0">
                    <Icon name="send" />
                </button>
            </div>
            {errorMessage && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {errorMessage}
                </div>
            )}
            {sendStatus && !errorMessage && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-700">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                    {sendStatus}
                </div>
            )}
        </div>
    );
};
