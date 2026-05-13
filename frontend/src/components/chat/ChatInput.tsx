import { Icon } from '../ui/Icon.js';

interface ChatInputProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSend: () => void;
}

export const ChatInput = ({ value, onChange, onSend }: ChatInputProps) => {
    return (
        <div className="bg-white p-4">
            <div className="flex gap-2 items-end">
                <textarea
                    value={value}
                    onChange={onChange}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            onSend();
                        }
                    }}
                    placeholder="Сообщение..."
                    rows={1}
                    className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-y-auto"
                    style={{ maxHeight: '120px' }}
                />
                <button
                    onClick={onSend}
                    disabled={!value.trim()}
                    className="w-10 h-10 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                >
                    <Icon name="send" />
                </button>
            </div>
        </div>
    );
};
