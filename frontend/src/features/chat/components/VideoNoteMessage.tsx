import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '@/shared/types/domain.js';
import { Icon } from '@/shared/ui/Icon.js';
import { formatDuration } from '@/shared/utils/uploadValidation.js';

interface VideoNoteMessageProps {
  attachment: MessageAttachment;
  isOwn: boolean;
  selectionMode?: boolean;
  canSelect?: boolean;
  onSelectMessage?: () => void;
}

export const VideoNoteMessage = ({
  attachment,
  isOwn,
  selectionMode = false,
  canSelect = false,
  onSelectMessage,
}: VideoNoteMessageProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = attachment.decrypted_file_url || attachment.file_url;
  const initialDuration = attachment.duration_seconds ?? attachment.duration ?? 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);

  const togglePlay = useCallback(
    async (event?: React.MouseEvent | React.KeyboardEvent) => {
      event?.stopPropagation();

      if (selectionMode) {
        if (canSelect) {
          onSelectMessage?.();
        }
        return;
      }

      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (isPlaying) {
        video.pause();
        return;
      }

      document.querySelectorAll('audio[data-voice]').forEach(el => {
        (el as HTMLAudioElement).pause();
      });
      document.querySelectorAll('video[data-video-note]').forEach(el => {
        if (el !== video) {
          (el as HTMLVideoElement).pause();
        }
      });

      try {
        await video.play();
      } catch {
        setIsPlaying(false);
      }
    },
    [canSelect, isPlaying, onSelectMessage, selectionMode],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onLoadedMetadata = () => {
      if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      // Force a frame to be decoded so the paused state shows a video thumbnail
      if (video.readyState >= 1 && video.currentTime < 0.1) {
        video.currentTime = 0.001;
      }
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      video.currentTime = 0;
    };
    const onError = () => {
      console.error("[VideoNoteMessage] playback error", src, video.error?.code, video.error?.message);
      setIsPlaying(false);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
    }

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.pause();
    };
  }, [src]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(initialDuration);
  }, [initialDuration, src]);

  const sizeClass = isPlaying
    ? 'h-[150px] w-[150px] sm:h-[180px] sm:w-[180px]'
    : 'h-24 w-24';
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const timeLabel = isPlaying && duration > 0
    ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
    : formatDuration(duration);

  return (
    <div
      role="button"
      tabIndex={selectionMode && !canSelect ? -1 : 0}
      onClick={togglePlay}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !selectionMode) {
          e.preventDefault();
          void togglePlay(e);
        } else if (selectionMode && canSelect) {
          void togglePlay(e);
        }
      }}
      className={`group relative block cursor-pointer overflow-hidden rounded-full bg-black shadow-sm outline-none ring-1 ring-black/5 transition-[width,height,transform] duration-200 ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-sky-400/70 ${sizeClass}`}
      aria-label={isPlaying ? 'Пауза' : 'Воспроизвести видео-сообщение'}
      title={isPlaying ? 'Пауза' : 'Воспроизвести видео-сообщение'}
    >
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full object-cover"
        preload="metadata"
        playsInline
        data-video-note="true"
      />

      <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />
      {!isPlaying && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-black/20">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm ${isOwn ? 'bg-white/90 text-sky-700' : 'bg-white/90 text-sky-600'}`}
          >
            <Icon name="play" className="ml-0.5 h-4 w-4" filled />
          </span>
        </div>
      )}
      {isPlaying && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white shadow-sm transition-opacity opacity-0 group-hover:opacity-100">
            <Icon name="pause" className="h-4 w-4" filled />
          </span>
        </div>
      )}
      {duration > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 w-[72%] -translate-x-1/2 overflow-hidden rounded-full bg-black/60 text-center text-[10px] font-medium tabular-nums text-white">
          <div className="relative px-2 py-0.5">
            <div
              className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-100"
              style={{ width: `${progressPercent}%` }}
            />
            <span className="relative">{timeLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
};
