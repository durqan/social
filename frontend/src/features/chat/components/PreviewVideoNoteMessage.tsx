import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon.js';
import { formatDuration, formatFileSize } from '@/shared/utils/uploadValidation.js';

interface PreviewVideoNoteMessageProps {
  src: string;
  durationSeconds: number;
  sizeBytes: number;
  onDelete: () => void;
  onSend: () => void;
  sending?: boolean;
}

export const PreviewVideoNoteMessage = ({
  src,
  durationSeconds,
  sizeBytes,
  onDelete,
  onSend,
  sending = false,
}: PreviewVideoNoteMessageProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || sending) {
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
  }, [isPlaying, sending]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      video.currentTime = 0;
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.pause();
    };
  }, [src]);

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={sending}
          className="group relative h-32 w-32 flex-shrink-0 overflow-hidden rounded-full bg-black shadow-sm outline-none ring-1 ring-black/5 disabled:opacity-60 sm:h-40 sm:w-40"
          aria-label={isPlaying ? 'Пауза' : 'Воспроизвести записанный кружок'}
          title={isPlaying ? 'Пауза' : 'Воспроизвести записанный кружок'}
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
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-sky-700 shadow-sm">
                <Icon name="play" className="ml-0.5 h-4 w-4" filled />
              </span>
            </div>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800">Видео-сообщение</div>
          <div className="mt-1 text-xs text-gray-500">
            {formatDuration(durationSeconds)} • {formatFileSize(sizeBytes)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDelete}
              disabled={sending}
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-sm text-red-600 transition hover:bg-red-50 active:bg-red-100 disabled:opacity-50"
              title="Удалить кружок"
            >
              <Icon name="delete" className="h-3.5 w-3.5" />
              <span>Удалить</span>
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={sending}
              className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-sm font-medium text-white transition hover:bg-sky-700 active:bg-sky-800 disabled:opacity-50"
              title="Отправить кружок"
            >
              <Icon name="send" className="h-3.5 w-3.5" />
              <span>{sending ? 'Отправка...' : 'Отправить'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
