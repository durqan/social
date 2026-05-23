import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

interface ChatHeaderProps {
    recipientName?: string;
    selectionMode: boolean;
    selectedCount: number;
    onExitSelection: () => void;
    onDeleteClick: () => void;
    onStartAudioCall?: () => void;
}

export const ChatHeader = ({
                               recipientName,
                               selectionMode,
                               selectedCount,
                               onExitSelection,
                               onDeleteClick,
                               onStartAudioCall,
                           }: ChatHeaderProps) => {
    return (
        <div className="bg-white px-6 py-4 flex items-center gap-3 shadow-sm sticky top-0 z-10">
            {selectionMode ? (
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <button onClick={onExitSelection} className="text-gray-500">
                            <Icon name="close" className="w-6 h-6" />
                        </button>
                        <span className="font-semibold">Выбрано: {selectedCount}</span>
                    </div>
                    <button onClick={onDeleteClick} disabled={selectedCount === 0} className="text-red-500 disabled:opacity-50">
                        <Icon name="delete" />
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={recipientName} />
                        <div className="min-w-0">
                            <h2 className="font-semibold text-gray-800 truncate">{recipientName || 'Пользователь'}</h2>
                            <p className="text-xs text-green-600">● Онлайн</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onStartAudioCall}
                        disabled={!onStartAudioCall}
                        className="h-10 w-10 rounded-full bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50 disabled:hover:bg-green-50 flex items-center justify-center flex-shrink-0"
                        aria-label="Аудиозвонок"
                        title="Аудиозвонок"
                    >
                        <Icon name="phone" />
                    </button>
                </div>
            )}
        </div>
    );
};
