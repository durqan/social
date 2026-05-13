import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

interface ChatHeaderProps {
    recipientName?: string;
    selectionMode: boolean;
    selectedCount: number;
    onExitSelection: () => void;
    onDeleteClick: () => void;
}

export const ChatHeader = ({
                               recipientName,
                               selectionMode,
                               selectedCount,
                               onExitSelection,
                               onDeleteClick,
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
                <div className="flex items-center gap-3">
                    <Avatar name={recipientName} />
                    <div>
                        <h2 className="font-semibold text-gray-800">{recipientName || 'Пользователь'}</h2>
                        <p className="text-xs text-green-600">● Онлайн</p>
                    </div>
                </div>
            )}
        </div>
    );
};
