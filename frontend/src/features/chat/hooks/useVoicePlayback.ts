import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVoicePlaybackResult {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progressPercent: number;
  togglePlay: () => Promise<void>;
  seek: (time: number) => void;
}

/**
 * Shared voice playback hook.
 * Handles:
 * - single active playback (pause other [data-voice] audios)
 * - time/duration/progress state
 * - play/pause toggle
 * - seeking
 * - cleanup
 *
 * Used by VoiceMessage (for sent messages) and PreviewVoiceMessage (for local pre-send preview).
 * This ensures only one audio player implementation exists.
 */
export function useVoicePlayback(src: string, initialDuration?: number): UseVoicePlaybackResult {
  const audioRef = useRef<HTMLAudioElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => initialDuration ?? 0);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    // Pause any other voice players on the page (Telegram-like single active playback)
    document.querySelectorAll('audio[data-voice]').forEach((el) => {
      if (el !== audio) {
        (el as HTMLAudioElement).pause();
      }
    });

    try {
      await audio.play();
    } catch (err) {
      console.error('Failed to play voice', err);
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const dur = duration || initialDuration || 0;
      const clamped = Math.max(0, Math.min(dur, time));
      audio.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [duration, initialDuration],
  );

  // Attach listeners via effect (stable across renders)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    // If src already loaded, try to read duration
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
    };
  }, [src]);

  // Reset state when source changes
  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
    if (initialDuration && initialDuration > 0) {
      setDuration(initialDuration);
    } else {
      setDuration(0);
    }
  }, [src, initialDuration]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    progressPercent,
    togglePlay,
    seek,
  };
}
