import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Icon } from "@/shared/ui/Icon.js";
import EmojiPickerModule, { EmojiStyle, type EmojiClickData, type Props as EmojiPickerProps } from 'emoji-picker-react';

const EmojiPicker = EmojiPickerModule as unknown as (props: EmojiPickerProps) => ReactElement | null;

interface ChatInputProps {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    onSend: (files?: File[]) => void;
}

export const ChatInput = ({ value, onChange, onSend }: ChatInputProps) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const canSend = Boolean(value.trim()) || selectedFiles.length > 0;
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    useEffect(() => {
        const urls = selectedFiles.map(file => URL.createObjectURL(file));
        setPreviews(urls);

        return () => {
            urls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [selectedFiles]);

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = () => {
        if (!canSend) return;
        onSend(selectedFiles);
        setSelectedFiles([]);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="border-t border-gray-200/80 bg-white/95 p-3 backdrop-blur sm:p-4">
            {selectedFiles.length > 0 && (
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {selectedFiles.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                            <img
                                src={previews[index]}
                                alt={file.name}
                                className="h-full w-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => removeFile(index)}
                                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                                aria-label="Убрать картинку"
                            >
                                <Icon name="close" className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
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
                        const files = Array.from(e.target.files || []).slice(0, 5);
                        setSelectedFiles(files);
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
                    value={value}
                    onChange={onChange}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder="Сообщение..."
                    rows={1}
                    className="app-input flex-1 px-3 py-2 text-sm resize-none overflow-y-auto sm:px-4 sm:text-base"
                    style={{ maxHeight: '120px' }}
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
                    onClick={handleSend}
                    disabled={!canSend}
                    className="w-10 h-10 bg-sky-600 text-white rounded-full hover:bg-sky-700 transition disabled:opacity-50 flex items-center justify-center flex-shrink-0">
                    <Icon name="send" />
                </button>
            </div>
        </div>
    );
};
