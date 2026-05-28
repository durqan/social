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
    localVideoRef: RefObject<HTMLVideoElement | null>;
    remoteVideoRef: RefObject<HTMLVideoElement | null>;
    onToggleExpanded: () => void;
    onAccept: () => void;
    onReject: () => void;
    onEnd: () => void;
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

export function CallOverlay({
    status,
    callType,
    peerName,
    error,
    isExpanded,
    localVideoRef,
    remoteVideoRef,
    onToggleExpanded,
    onAccept,
    onReject,
    onEnd,
}: CallOverlayProps) {
    if (status === 'idle') {
        return null;
    }

    const expandedVideo = isExpanded && callType === 'video';

    return (
        <div className={
            expandedVideo
                ? 'fixed inset-0 z-50 flex flex-col bg-gray-950 text-white'
                : 'fixed inset-x-3 bottom-3 z-50 rounded-lg bg-white p-3 shadow-xl border border-gray-200 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[min(440px,calc(100vw-32px))] sm:p-4'
        }>
            {callType === 'video' && (
                <div className={
                    isExpanded
                        ? 'relative flex-1 overflow-hidden bg-gray-950'
                        : 'mb-4 overflow-hidden rounded-lg bg-gray-900 aspect-video relative'
                }>
                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className="h-full w-full object-cover"
                    />

                    <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className={
                            isExpanded
                                ? 'absolute right-3 top-3 h-28 w-20 rounded-lg bg-gray-800 object-cover border border-white/30 shadow sm:h-36 sm:w-56'
                                : 'absolute bottom-2 right-2 h-20 w-24 rounded-md bg-gray-800 object-cover border border-white/30 shadow sm:bottom-3 sm:right-3 sm:h-24 sm:w-32'
                        }
                    />

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

            <div className={isExpanded ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-16 sm:p-6 sm:pt-20' : 'flex items-center gap-3'}>
                {!isExpanded && <Avatar name={peerName} />}

                <div className={isExpanded ? 'min-w-0 text-center' : 'min-w-0 flex-1'}>
                    <p className={isExpanded ? 'truncate text-lg font-semibold text-white' : 'font-semibold text-gray-900 truncate'}>
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

                <div className={isExpanded ? 'mt-5 flex justify-center gap-3' : 'mt-4 flex justify-end gap-2'}>
                    {status === 'incoming' && (
                        <button
                            type="button"
                            onClick={onAccept}
                            className={isExpanded ? 'h-12 w-12 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center' : 'h-10 w-10 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center'}
                            aria-label="Принять звонок"
                            title="Принять звонок"
                        >
                            <Icon name="phone" />
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={status === 'incoming' ? onReject : onEnd}
                        className={isExpanded ? 'h-12 w-12 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center' : 'h-10 w-10 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center'}
                        aria-label="Завершить звонок"
                        title="Завершить звонок"
                    >
                        <Icon name="phoneOff" />
                    </button>
                </div>
            </div>
        </div>
    );
}
