import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

interface ChatHeaderProps {
    recipientName?: string;
    selectionMode: boolean;
    selectedCount: number;
    onExitSelection: () => void;
    onDeleteClick: () => void;
    onStartAudioCall?: () => void;
    onStartVideoCall?: () => void;
}

export const ChatHeader = ({
                               recipientName,
                               selectionMode,
                               selectedCount,
                               onExitSelection,
                               onDeleteClick,
                               onStartAudioCall,
                               onStartVideoCall,
                           }: ChatHeaderProps) => {
    return (
        <div className="bg-white px-3 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-10 sm:px-6 sm:py-4">
            {selectionMode ? (
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <button onClick={onExitSelection} className="text-gray-500">
                            <Icon name="close" className="w-6 h-6" />
                        </button>
                        <span className="font-semibold text-sm sm:text-base">Выбрано: {selectedCount}</span>
                    </div>
                    <button onClick={onDeleteClick} disabled={selectedCount === 0} className="text-red-500 disabled:opacity-50">
                        <Icon name="delete" />
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full gap-2 sm:gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={recipientName} />
                        <div className="min-w-0">
                            <h2 className="font-semibold text-gray-800 truncate text-sm sm:text-base">{recipientName || 'Пользователь'}</h2>
                            <p className="text-xs text-green-600">● Онлайн</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 sm:gap-2">
                        <button
                            type="button"
                            onClick={onStartAudioCall}
                            disabled={!onStartAudioCall}
                            className="h-9 w-9 rounded-full bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50 disabled:hover:bg-green-50 flex items-center justify-center sm:h-10 sm:w-10"
                            aria-label="Аудиозвонок"
                            title="Аудиозвонок"
                        >
                            <Icon name="phone" />
                        </button>

                        <button
                            type="button"
                            onClick={onStartVideoCall}
                            disabled={!onStartVideoCall}
                            className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:hover:bg-blue-50 flex items-center justify-center sm:h-10 sm:w-10"
                            aria-label="Видеозвонок"
                            title="Видеозвонок"
                        >
                            <Icon name="video" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
