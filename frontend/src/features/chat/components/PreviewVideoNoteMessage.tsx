import { useCallback, useRef, useState } from 'react';
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);

  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      // pause other videos? simple
      document.querySelectorAll('video').forEach(el => { if (el !== v) el.pause(); });
      try { await v.play(); } catch { setIsPlaying(false); }
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  };
  const handleLoaded = () => {
    const v = videoRef.current;
    if (v && isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
  };
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    const v = videoRef.current;
    if (v) v.currentTime = 0;
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const displayDur = duration || durationSeconds;
  const sizeLabel = formatFileSize(sizeBytes);

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface-muted p-3 shadow-app">
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border border-border bg-black">
          <video
            ref={videoRef}
            src={src}
            className="h-full w-full object-cover"
            muted={false}
            playsInline
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoaded}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
          />
          <button
            type="button"
            onClick={() => void togglePlay()}
            className="absolute inset-0 flex items-center justify-center bg-black/30 text-white"
            disabled={sending}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} className="h-5 w-5" filled />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Видео-сообщение</div>
          <div className="mt-0.5 text-[11px] text-text-secondary tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(displayDur)} • {sizeLabel}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-1.5 rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 pl-[4.5rem] text-sm">
        <button
          type="button"
          onClick={onDelete}
          disabled={sending}
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-danger transition hover:bg-danger-soft active:bg-danger-soft disabled:opacity-50"
        >
          <Icon name="delete" className="h-3.5 w-3.5" />
          <span>Удалить</span>
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-white transition hover:bg-primary-hover active:bg-primary disabled:opacity-50"
        >
          <Icon name="send" className="h-3.5 w-3.5" />
          <span>{sending ? 'Отправка...' : 'Отправить'}</span>
        </button>
      </div>
    </div>
  );
};
