import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '@/shared/types/domain.js';
import { formatDuration } from '@/shared/utils/uploadValidation.js';
import { Icon } from '@/shared/ui/Icon.js';

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
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => {
    return attachment.duration_seconds ?? attachment.duration ?? 0;
  });

  const src = attachment.file_url;

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

      const audio = audioRef.current;
      if (!audio) return;

      if (isPlaying) {
        audio.pause();
      } else {
        // Pause any other voice players on the page (Telegram-like single active playback)
        document.querySelectorAll('audio[data-voice]').forEach((el) => {
          if (el !== audio) {
            (el as HTMLAudioElement).pause();
          }
        });

        try {
          await audio.play();
        } catch (err) {
          console.error('Failed to play voice message', err);
          setIsPlaying(false);
        }
      }
    },
    [isPlaying, selectionMode, canSelect, onSelectMessage],
  );

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (selectionMode) {
        if (canSelect) {
          onSelectMessage?.();
        }
        return;
      }

      const audio = audioRef.current;
      const bar = progressRef.current;
      const dur = duration;
      if (!audio || !bar || !dur || dur <= 0) return;

      const rect = bar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      const newTime = percent * dur;

      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration, selectionMode, canSelect, onSelectMessage],
  );

  // Pause audio on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
      }
    };
  }, []);

  // Reset state when source changes (new voice)
  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
  }, [src]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const displayDuration = duration || (attachment.duration_seconds ?? attachment.duration ?? 0);

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
        aria-label={isPlaying ? 'Пауза' : 'Воспроизвести голосовое сообщение'}
        title={isPlaying ? 'Пауза' : 'Воспроизвести'}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} className="h-4 w-4" filled />
      </button>

      <div
        className="flex-1 py-1 cursor-pointer"
        ref={progressRef}
        onClick={handleProgressClick}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.floor(displayDuration)}
        aria-valuenow={Math.floor(currentTime)}
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
        {formatDuration(currentTime)} / {formatDuration(displayDuration)}
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        data-voice="true"
      />
    </div>
  );
};
