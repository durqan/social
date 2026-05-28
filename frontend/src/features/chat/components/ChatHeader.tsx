import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

interface ChatHeaderProps {
    recipientName?: string;
    selectionMode: boolean;
    selectedCount: number;
    onBack?: () => void;
    onExitSelection: () => void;
    onDeleteClick: () => void;
    onStartAudioCall?: () => void;
    onStartVideoCall?: () => void;
}

export const ChatHeader = ({
                               recipientName,
                               selectionMode,
                               selectedCount,
                               onBack,
                               onExitSelection,
                               onDeleteClick,
                               onStartAudioCall,
                               onStartVideoCall,
                           }: ChatHeaderProps) => {
    return (
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200/80 bg-white/95 px-3 py-3 backdrop-blur sm:px-5 sm:py-4">
            {selectionMode ? (
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <button onClick={onExitSelection} className="icon-button h-9 w-9 text-gray-500">
                            <Icon name="close" className="w-6 h-6" />
                        </button>
                        <span className="font-semibold text-sm sm:text-base">Выбрано: {selectedCount}</span>
                    </div>
                    <button onClick={onDeleteClick} disabled={selectedCount === 0} className="icon-button h-9 w-9 text-red-500 disabled:opacity-50">
                        <Icon name="delete" />
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full gap-2 sm:gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {onBack && (
                            <button
                                type="button"
                                onClick={onBack}
                                className="icon-button h-9 w-9 flex-shrink-0 text-gray-500 lg:hidden"
                                aria-label="Назад к чатам"
                                title="Назад"
                            >
                                <Icon name="arrowLeft" />
                            </button>
                        )}
                        <Avatar name={recipientName} />
                        <div className="min-w-0">
                            <h2 className="font-semibold text-gray-950 truncate text-sm sm:text-base">{recipientName || 'Пользователь'}</h2>
                            <p className="text-xs text-emerald-600">● Онлайн</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 sm:gap-2">
                        <button
                            type="button"
                            onClick={onStartAudioCall}
                            disabled={!onStartAudioCall}
                            className="h-9 w-9 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 disabled:hover:bg-emerald-50 flex items-center justify-center sm:h-10 sm:w-10"
                            aria-label="Аудиозвонок"
                            title="Аудиозвонок"
                        >
                            <Icon name="phone" />
                        </button>

                        <button
                            type="button"
                            onClick={onStartVideoCall}
                            disabled={!onStartVideoCall}
                            className="h-9 w-9 rounded-full bg-sky-50 text-sky-600 hover:bg-sky-100 disabled:opacity-50 disabled:hover:bg-sky-50 flex items-center justify-center sm:h-10 sm:w-10"
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
