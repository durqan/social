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
  const src = attachment.file_url;
  const initialDuration = attachment.duration_seconds ?? attachment.duration ?? 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(initialDuration);

  const togglePlay = useCallback(
    async (event?: React.MouseEvent) => {
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
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      video.currentTime = 0;
    };
    const onError = () => {
      console.error("[VideoNoteMessage] playback error", src, video.error?.code, video.error?.message);
      setIsPlaying(false);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
    }

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.pause();
    };
  }, [src]);

  useEffect(() => {
    setIsPlaying(false);
    setDuration(initialDuration);
  }, [initialDuration, src]);

  return (
    <button
      type="button"
      onClick={togglePlay}
      className="group relative block h-32 w-32 overflow-hidden rounded-full bg-black shadow-sm outline-none ring-1 ring-black/5 transition active:scale-[0.98] sm:h-40 sm:w-40"
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
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 opacity-100 transition group-hover:bg-black/20">
        {!isPlaying && (
          <span className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm ${isOwn ? 'bg-white/90 text-sky-700' : 'bg-white/90 text-sky-600'}`}>
            <Icon name="play" className="ml-0.5 h-4 w-4" filled />
          </span>
        )}
      </div>
      {duration > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(duration)}
        </div>
      )}
    </button>
  );
};
