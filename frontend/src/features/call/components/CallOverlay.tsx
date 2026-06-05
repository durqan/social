import type { RefObject } from 'react';

import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";
import type { CallStatus, CallType } from "@/features/call/types.js";

type CallOverlayProps = {
    status: CallStatus;
    callType: CallType;
    peerName: string;
    error: string | null;
    isExpanded: boolean;
    peerUserId: number | null;
    isMicrophoneOn: boolean;
    isCameraOn: boolean;
    hasLocalVideo: boolean;
    canSwitchCamera: boolean;
    isSwitchingCamera: boolean;
    isChatOpen: boolean;
    unreadChatCount: number;
    localVideoRef: RefObject<HTMLVideoElement | null>;
    remoteVideoRef: RefObject<HTMLVideoElement | null>;
    onToggleExpanded: () => void;
    onToggleMicrophone: () => void;
    onToggleCamera: () => void;
    onSwitchCamera: () => void;
    onToggleChat: () => void;
    onAccept: () => void;
    onReject: () => void;
    onEnd: () => void;
    onOpenPeerProfile?: (userId: number) => void;
};

const statusText = (status: CallStatus, callType: CallType) => {
    if (status === 'incoming') {
        return callType === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок';
    }

    if (status === 'calling') {
        return 'Звоним...';
    }

    if (status === 'active') {
        return callType === 'video' ? 'Видеозвонок идет' : 'Аудиозвонок идет';
    }

    return '';
};

type ControlButtonProps = {
    icon: Parameters<typeof Icon>[0]['name'];
    label: string;
    tone?: 'default' | 'active' | 'off' | 'danger' | 'success';
    disabled?: boolean;
    pressed?: boolean;
    indicator?: number;
    onClick: () => void;
};

function ControlButton({
    icon,
    label,
    tone = 'default',
    disabled = false,
    pressed,
    indicator = 0,
    onClick,
}: ControlButtonProps) {
    const toneClass = {
        default: 'bg-white/90 text-gray-800 hover:bg-white',
        active: 'bg-sky-500 text-white hover:bg-sky-600',
        off: 'bg-amber-500 text-white hover:bg-amber-600',
        danger: 'bg-red-500 text-white hover:bg-red-600',
        success: 'bg-emerald-500 text-white hover:bg-emerald-600',
    }[tone];

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            aria-pressed={pressed}
            title={label}
            className={`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 sm:h-12 sm:w-12 ${toneClass}`}
        >
            <Icon name={icon} />
            {indicator > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white ring-2 ring-white">
                    {indicator > 9 ? '9+' : indicator}
                </span>
            )}
        </button>
    );
}

export function CallOverlay({
    status,
    callType,
    peerName,
    error,
    isExpanded,
    peerUserId,
    isMicrophoneOn,
    isCameraOn,
    hasLocalVideo,
    canSwitchCamera,
    isSwitchingCamera,
    isChatOpen,
    unreadChatCount,
    localVideoRef,
    remoteVideoRef,
    onToggleExpanded,
    onToggleMicrophone,
    onToggleCamera,
    onSwitchCamera,
    onToggleChat,
    onAccept,
    onReject,
    onEnd,
    onOpenPeerProfile,
}: CallOverlayProps) {
    if (status === 'idle') {
        return null;
    }

    const expandedVideo = isExpanded && callType === 'video';
    const showCallControls = status !== 'incoming';
    const showCameraControls = callType === 'video' && hasLocalVideo;
    const videoTileClass = isExpanded
        ? 'absolute right-3 top-3 h-28 w-20 overflow-hidden rounded-lg border border-white/30 bg-gray-800 shadow sm:h-36 sm:w-56'
        : 'absolute bottom-2 right-2 h-20 w-24 overflow-hidden rounded-md border border-white/30 bg-gray-800 shadow sm:bottom-3 sm:right-3 sm:h-24 sm:w-32';
    const openPeerProfile = peerUserId && onOpenPeerProfile
        ? () => onOpenPeerProfile(peerUserId)
        : undefined;

    const controls = status === 'incoming' ? (
        <>
            <ControlButton icon="phone" label="Принять звонок" tone="success" onClick={onAccept} />
            <ControlButton icon="phoneOff" label="Отклонить звонок" tone="danger" onClick={onReject} />
        </>
    ) : (
        <>
            <ControlButton
                icon={isMicrophoneOn ? 'mic' : 'micOff'}
                label={isMicrophoneOn ? 'Микрофон включен' : 'Микрофон выключен'}
                tone={isMicrophoneOn ? 'default' : 'off'}
                pressed={!isMicrophoneOn}
                onClick={onToggleMicrophone}
            />

            {showCameraControls && (
                <ControlButton
                    icon={isCameraOn ? 'video' : 'videoOff'}
                    label={isCameraOn ? 'Камера включена' : 'Камера выключена'}
                    tone={isCameraOn ? 'default' : 'off'}
                    pressed={!isCameraOn}
                    onClick={onToggleCamera}
                />
            )}

            {showCameraControls && canSwitchCamera && (
                <ControlButton
                    icon="switchCamera"
                    label="Переключить камеру"
                    disabled={isSwitchingCamera}
                    onClick={onSwitchCamera}
                />
            )}

            {peerUserId && (
                <ControlButton
                    icon="messages"
                    label={isChatOpen ? 'Закрыть чат' : 'Открыть чат'}
                    tone={isChatOpen ? 'active' : 'default'}
                    pressed={isChatOpen}
                    indicator={isChatOpen ? 0 : unreadChatCount}
                    onClick={onToggleChat}
                />
            )}

            <ControlButton icon="phoneOff" label="Завершить звонок" tone="danger" onClick={onEnd} />
        </>
    );

    return (
        <div className={
            expandedVideo
                ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-gray-950 text-white'
                : 'fixed inset-x-3 bottom-3 z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[min(460px,calc(100vw-32px))]'
        }>
            {callType === 'video' && (
                <div className={
                    isExpanded
                        ? 'relative flex-1 overflow-hidden bg-gray-950'
                        : 'relative aspect-video overflow-hidden bg-gray-900'
                }>
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                        <Avatar
                            name={peerName}
                            size="lg"
                            ariaLabel={`Открыть профиль ${peerName || 'пользователя'}`}
                            onClick={openPeerProfile}
                        />
                    </div>

                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className="relative h-full w-full object-cover"
                    />

                    <div className={videoTileClass}>
                        <video
                            ref={localVideoRef}
                            autoPlay
                            muted
                            playsInline
                            className={`h-full w-full object-cover ${isCameraOn ? '' : 'hidden'}`}
                        />

                        {!isCameraOn && (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-800 text-white">
                                <Icon name="videoOff" className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Камера выкл.</span>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        className="absolute left-3 top-3 h-10 w-10 rounded-full bg-black/45 text-white hover:bg-black/60 flex items-center justify-center"
                        aria-label={isExpanded ? 'Свернуть видеозвонок' : 'Развернуть видеозвонок'}
                        title={isExpanded ? 'Свернуть' : 'На весь экран'}
                    >
                        <Icon name={isExpanded ? 'minimize' : 'maximize'} />
                    </button>
                </div>
            )}

            <div className={isExpanded ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-16 sm:p-6 sm:pt-20' : 'p-3 sm:p-4'}>
                <div className={isExpanded ? 'mx-auto flex max-w-3xl flex-col items-center gap-4' : 'flex items-center gap-3'}>
                    {!isExpanded && (
                        <Avatar
                            name={peerName}
                            ariaLabel={`Открыть профиль ${peerName || 'пользователя'}`}
                            onClick={openPeerProfile}
                        />
                    )}

                    <div className={isExpanded ? 'min-w-0 text-center' : 'min-w-0 flex-1'}>
                        <p className={isExpanded ? 'truncate text-lg font-semibold text-white' : 'truncate font-semibold text-gray-900'}>
                            {peerName}
                        </p>

                        <p className={isExpanded ? 'text-sm text-gray-200' : 'text-sm text-gray-500'}>
                            {statusText(status, callType)}
                        </p>

                        {error && (
                            <p className={isExpanded ? 'mt-1 text-xs text-red-200' : 'mt-1 text-xs text-red-500'}>
                                {error}
                            </p>
                        )}
                    </div>

                    {!showCallControls && (
                        <div className="flex flex-shrink-0 justify-end gap-2">
                            {controls}
                        </div>
                    )}
                </div>

                {showCallControls && (
                    <div className={isExpanded ? 'mt-5 flex justify-center gap-3' : 'mt-4 flex justify-center gap-2 sm:justify-end'}>
                        {controls}
                    </div>
                )}
            </div>
        </div>
    );
}
