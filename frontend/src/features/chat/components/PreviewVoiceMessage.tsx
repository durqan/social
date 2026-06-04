import { useCallback, useRef } from 'react';
import { Icon } from '@/shared/ui/Icon.js';
import { formatDuration, formatFileSize } from '@/shared/utils/uploadValidation.js';
import { useVoicePlayback } from '@/features/chat/hooks/useVoicePlayback.js';

interface PreviewVoiceMessageProps {
  src: string;
  durationSeconds: number;
  sizeBytes: number;
  onDelete: () => void;
  onSend: () => void;
  sending?: boolean;
}

export const PreviewVoiceMessage = ({
  src,
  durationSeconds,
  sizeBytes,
  onDelete,
  onSend,
  sending = false,
}: PreviewVoiceMessageProps) => {
  const progressRef = useRef<HTMLDivElement>(null);

  const player = useVoicePlayback(src, durationSeconds);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current;
      const dur = player.duration || durationSeconds;
      if (!bar || !dur || dur <= 0) return;

      const rect = bar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      player.seek(percent * dur);
    },
    [player, durationSeconds],
  );

  const displayDuration = player.duration || durationSeconds;
  const sizeLabel = formatFileSize(sizeBytes);

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm">
      {/* Player row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void player.togglePlay()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-600 text-white shadow-sm transition hover:bg-sky-700 active:bg-sky-800"
          aria-label={player.isPlaying ? 'Пауза' : 'Воспроизвести запись'}
          title={player.isPlaying ? 'Пауза' : 'Воспроизвести'}
          disabled={sending}
        >
          <Icon name={player.isPlaying ? 'pause' : 'play'} className="h-4 w-4" filled />
        </button>

        <div
          ref={progressRef}
          className="flex-1 cursor-pointer py-1"
          onClick={handleProgressClick}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.floor(displayDuration)}
          aria-valuenow={Math.floor(player.currentTime)}
          aria-label="Позиция воспроизведения записанного голосового"
        >
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-300/70">
            <div
              className="absolute left-0 top-0 h-1.5 rounded-full bg-sky-500 transition-[width] duration-75"
              style={{ width: `${player.progressPercent}%` }}
            />
          </div>
        </div>

        <div className="w-[5.5rem] flex-shrink-0 text-right text-[10px] tabular-nums font-medium tracking-tight text-gray-500">
          {formatDuration(player.currentTime)} / {formatDuration(displayDuration)}
        </div>
      </div>

      {/* Meta row: duration + size */}
      <div className="mt-1 pl-12 text-[10px] text-gray-500">
        {formatDuration(displayDuration)} • {sizeLabel}
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
        <button
          type="button"
          onClick={onDelete}
          disabled={sending}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          title="Удалить запись"
        >
          <Icon name="delete" className="h-4 w-4" />
          <span>Удалить</span>
        </button>

        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
          title="Отправить голосовое сообщение"
        >
          <Icon name="send" className="h-4 w-4" />
          <span>{sending ? 'Отправка...' : 'Отправить'}</span>
        </button>
      </div>

      <audio ref={player.audioRef} src={src} preload="metadata" data-voice="true" />
    </div>
  );
};
