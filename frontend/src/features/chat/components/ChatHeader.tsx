import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";
import {formatLastSeen} from "@/shared/utils/date.js";

interface ChatHeaderProps {
    recipientId?: number;
    recipientName?: string;
    recipientAvatar?: string | null;
    recipientAvatarPositionX?: number;
    recipientAvatarPositionY?: number;
    recipientAvatarScale?: number;
    recipientStatus?: boolean;
    selectionMode: boolean;
    selectedCount: number;
    onBack?: () => void;
    onExitSelection: () => void;
    onDeleteClick: () => void;
    onStartAudioCall?: () => void;
    onStartVideoCall?: () => void;
    onOpenRecipient?: (recipientId: number) => void;
    recipientLastSeenAt?: string | null;
}

export const ChatHeader = ({
                               recipientId,
                               recipientName,
                               recipientAvatar,
                               recipientAvatarPositionX,
                               recipientAvatarPositionY,
                               recipientAvatarScale,
                               recipientStatus,
                               selectionMode,
                               selectedCount,
                               onBack,
                               onExitSelection,
                               onDeleteClick,
                               onStartAudioCall,
                               onStartVideoCall,
                               onOpenRecipient,
                               recipientLastSeenAt,
                           }: ChatHeaderProps) => {
    const statusText = recipientStatus
        ? 'в сети'
        : formatLastSeen(recipientLastSeenAt);
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
                        <Avatar
                            name={recipientName}
                            src={recipientAvatar}
                            positionX={recipientAvatarPositionX}
                            positionY={recipientAvatarPositionY}
                            scale={recipientAvatarScale}
                            ariaLabel={`Открыть профиль ${recipientName || 'собеседника'}`}
                            onClick={recipientId && onOpenRecipient ? () => onOpenRecipient(recipientId) : undefined}
                        />
                        <div className="min-w-0">
                            <h2 className="font-semibold text-gray-950 truncate text-sm sm:text-base">{recipientName || 'Пользователь'}</h2>
                            {statusText && (
                                <p className={recipientStatus ? 'text-xs text-emerald-600' : 'text-xs text-gray-400'}>
                                    {statusText}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 sm:gap-2">
                        <button
                            type="button"
                            onClick={onStartAudioCall}
                            disabled={!onStartAudioCall}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-colors hover:!bg-emerald-800 hover:!text-white disabled:cursor-default disabled:opacity-50 disabled:hover:!bg-emerald-50 disabled:hover:!text-emerald-600 sm:h-10 sm:w-10"
                            aria-label="Аудиозвонок"
                            title="Аудиозвонок"
                        >
                            <Icon name="phone" className="pointer-events-none h-5 w-5" />
                        </button>

                        <button
                            type="button"
                            onClick={onStartVideoCall}
                            disabled={!onStartVideoCall}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-sky-50 text-sky-600 transition-colors hover:!bg-sky-800 hover:!text-white disabled:cursor-default disabled:opacity-50 disabled:hover:!bg-sky-50 disabled:hover:!text-sky-600 sm:h-10 sm:w-10"
                            aria-label="Видеозвонок"
                            title="Видеозвонок"
                        >
                            <Icon name="video" className="pointer-events-none h-5 w-5" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
