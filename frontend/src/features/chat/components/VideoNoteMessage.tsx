import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '@/shared/types/domain.js';
import { formatDuration } from '@/shared/utils/uploadValidation.js';
import { Icon } from '@/shared/ui/Icon.js';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(attachment.duration_seconds ?? attachment.duration ?? 0);
  const [hasPoster, setHasPoster] = useState(false);

  const src = attachment.file_url;
  const initialDuration = attachment.duration_seconds ?? attachment.duration ?? 0;

  const togglePlay = useCallback(
    async (e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      if (selectionMode) {
        if (canSelect) onSelectMessage?.();
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      if (isPlaying) {
        v.pause();
        return;
      }
      // pause other video notes / voices? simple global pause for media
      document.querySelectorAll('video, audio[data-voice]').forEach(el => {
        if (el !== v) (el as HTMLMediaElement).pause();
      });
      try {
        await v.play();
      } catch {
        setIsPlaying(false);
      }
    },
    [isPlaying, selectionMode, canSelect, onSelectMessage],
  );

  const handleTime = () => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  };
  const handleMeta = () => {
    const v = videoRef.current;
    if (v && isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
    }
  };
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    const v = videoRef.current;
    if (v) v.currentTime = 0;
  };

  useEffect(() => {
    // reset on src change
    setCurrentTime(0);
    setIsPlaying(false);
    setDuration(initialDuration || 0);
  }, [src, initialDuration]);

  const displayDuration = duration || initialDuration || 0;
  const progress = displayDuration > 0 ? Math.min(100, (currentTime / displayDuration) * 100) : 0;

  // Circular progress: svg ring. radius 28 for ~56px inner? container 72px for nice circle
  const size = 72;
  const r = 30;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - progress / 100);

  const handleClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      if (canSelect) onSelectMessage?.();
      return;
    }
    void togglePlay(e);
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    // eslint-disable-next-line no-console
    console.error('[VideoNoteMessage] playback error', src, e);
    setIsPlaying(false);
  };

  const bubbleClass = isOwn ? 'bubble-own' : 'bubble-other';

  return (
    <div
      className={`relative flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full ${bubbleClass} cursor-pointer`}
      onClick={handleClick}
      role="button"
      aria-label={isPlaying ? 'Пауза видео-сообщения' : 'Воспроизвести видео-сообщение'}
    >
      <video
        ref={videoRef}
        src={src}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        preload="metadata"
        onTimeUpdate={handleTime}
        onLoadedMetadata={handleMeta}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleError}
        // poster can be set if backend provides thumb, but not; first frame after load
      />
      {/* dark overlay for contrast */}
      <div className="absolute inset-0 rounded-full bg-black/20 pointer-events-none" />

      {/* center play / pause */}
      {!isPlaying && (
        <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white pointer-events-none">
          <Icon name="play" className="h-3.5 w-3.5 ml-0.5" filled />
        </div>
      )}
      {isPlaying && (
        <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white pointer-events-none">
          <Icon name="pause" className="h-3.5 w-3.5" filled />
        </div>
      )}

      {/* circular progress ring */}
      <svg className="absolute inset-0 -rotate-90 pointer-events-none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={dash}
          strokeLinecap="round"
        />
      </svg>

      {/* duration badge bottom */}
      <div className="absolute bottom-1 right-1 z-10 rounded bg-black/70 px-1 py-0 text-[9px] tabular-nums text-white pointer-events-none">
        {formatDuration(displayDuration)}
      </div>
    </div>
  );
};
