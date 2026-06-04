import { useCallback, useRef } from 'react';
import type { MessageAttachment } from '@/shared/types/domain.js';
import { formatDuration } from '@/shared/utils/uploadValidation.js';
import { Icon } from '@/shared/ui/Icon.js';
import { useVoicePlayback } from '@/features/chat/hooks/useVoicePlayback.js';

interface VoiceMessageProps {
  attachment: MessageAttachment;
  isOwn: boolean;
  selectionMode?: boolean;
  canSelect?: boolean;
  onSelectMessage?: () => void;
}

export const VoiceMessage = ({
  attachment,
  isOwn,
  selectionMode = false,
  canSelect = false,
  onSelectMessage,
}: VoiceMessageProps) => {
  const progressRef = useRef<HTMLDivElement>(null);

  const src = attachment.file_url;
  const initialDuration = attachment.duration_seconds ?? attachment.duration ?? 0;

  const player = useVoicePlayback(src, initialDuration);

  const togglePlay = useCallback(
    async (e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      if (selectionMode) {
        if (canSelect) {
          onSelectMessage?.();
        }
        return;
      }
      await player.togglePlay();
    },
    [player, selectionMode, canSelect, onSelectMessage],
  );

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (selectionMode) {
        if (canSelect) {
          onSelectMessage?.();
        }
        return;
      }

      const bar = progressRef.current;
      const dur = player.duration || initialDuration;
      if (!bar || !dur || dur <= 0) return;

      const rect = bar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      const newTime = percent * dur;

      player.seek(newTime);
    },
    [player, initialDuration, selectionMode, canSelect, onSelectMessage],
  );

  const progressPercent = player.progressPercent;
  const displayDuration = player.duration || initialDuration;

  const playButtonClass = isOwn
    ? 'bg-sky-600 text-white hover:bg-sky-700 active:bg-sky-800'
    : 'bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700';

  return (
    <div
      className={`flex min-w-56 items-center gap-2.5 rounded-xl px-3 py-2 ${isOwn ? 'bg-white/70' : 'bg-gray-50'}`}
      onClick={(event) => {
        if (selectionMode) {
          event.preventDefault();
          event.stopPropagation();
          if (canSelect) {
            onSelectMessage?.();
          }
          return;
        }
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={togglePlay}
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition shadow-sm ${playButtonClass}`}
        aria-label={player.isPlaying ? 'Пауза' : 'Воспроизвести голосовое сообщение'}
        title={player.isPlaying ? 'Пауза' : 'Воспроизвести'}
      >
        <Icon name={player.isPlaying ? 'pause' : 'play'} className="h-4 w-4" filled />
      </button>

      <div
        className="flex-1 py-1 cursor-pointer"
        ref={progressRef}
        onClick={handleProgressClick}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.floor(displayDuration)}
        aria-valuenow={Math.floor(player.currentTime)}
        aria-label="Позиция воспроизведения голосового сообщения"
      >
        <div className="relative h-1.5 w-full bg-gray-300/70 rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-1.5 bg-sky-500 rounded-full transition-[width] duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="text-[10px] tabular-nums font-medium text-gray-500 flex-shrink-0 w-[4.5rem] text-right tracking-tight">
        {formatDuration(player.currentTime)} / {formatDuration(displayDuration)}
      </div>

      <audio ref={player.audioRef} src={src} preload="metadata" data-voice="true" />
    </div>
  );
};
