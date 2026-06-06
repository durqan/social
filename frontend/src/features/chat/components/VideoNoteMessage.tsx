import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { MessageAttachment } from '@/shared/types/domain.js';
import { formatDuration } from '@/shared/utils/uploadValidation.js';
import { VideoNoteOrbit } from '@/features/chat/components/VideoNoteOrbit.js';

interface VideoNoteMessageProps {
  attachment: MessageAttachment;
  isOwn: boolean;
  timestamp?: string;
  statusLabel?: string;
  selectionMode?: boolean;
  canSelect?: boolean;
  onSelectMessage?: () => void;
}

export const VideoNoteMessage = ({
  attachment,
  isOwn,
  timestamp,
  statusLabel,
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
    async (event?: MouseEvent<HTMLButtonElement>) => {
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

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const timeLabel = isPlaying && duration > 0
    ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
    : formatDuration(duration);

  return (
    <div className={`video-note-message ${isOwn ? 'video-note-message--own' : ''}`}>
      <VideoNoteOrbit
        isPlaying={isPlaying}
        progressPercent={progressPercent}
        timeLabel={duration > 0 ? timeLabel : undefined}
        controlIcon={isPlaying ? 'pause' : 'play'}
        disabled={selectionMode && !canSelect}
        tabIndex={selectionMode && !canSelect ? -1 : 0}
        onClick={(event) => void togglePlay(event)}
        ariaLabel={isPlaying ? 'Пауза' : 'Воспроизвести видео-сообщение'}
        title={isPlaying ? 'Пауза' : 'Воспроизвести видео-сообщение'}
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          data-video-note="true"
        />
      </VideoNoteOrbit>

      {timestamp && (
        <div className="video-note-message__timestamp">
          {timestamp}
          {statusLabel && <span className="ml-1">{statusLabel}</span>}
        </div>
      )}
    </div>
  );
};
