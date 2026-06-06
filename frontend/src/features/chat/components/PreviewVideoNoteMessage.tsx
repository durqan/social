import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui/Icon.js';
import { formatDuration, formatFileSize } from '@/shared/utils/uploadValidation.js';
import { VideoNoteOrbit } from '@/features/chat/components/VideoNoteOrbit.js';

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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);

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

    const onLoadedMetadata = () => {
      if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
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

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
    }

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.pause();
    };
  }, [src]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(durationSeconds);
  }, [durationSeconds, src]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const timeLabel = isPlaying && duration > 0
    ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
    : formatDuration(duration);
  const sizeLabel = formatFileSize(sizeBytes);

  return (
    <div className="video-note-preview mb-3">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <VideoNoteOrbit
          isPlaying={isPlaying}
          progressPercent={progressPercent}
          timeLabel={duration > 0 ? timeLabel : undefined}
          controlIcon={isPlaying ? 'pause' : 'play'}
          disabled={sending}
          onClick={() => void togglePlay()}
          ariaLabel={isPlaying ? 'Пауза' : 'Воспроизвести записанный кружок'}
          title={isPlaying ? 'Пауза' : 'Воспроизвести записанный кружок'}
        >
          <video
            ref={videoRef}
            src={src}
            preload="metadata"
            playsInline
            data-video-note="true"
          />
        </VideoNoteOrbit>

        <div className="video-note-preview__panel min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--app-text-primary)]">Видео-сообщение</div>
          <div className="mt-1 text-xs text-[var(--app-text-secondary)]">
            {formatDuration(duration)} • {sizeLabel}
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
