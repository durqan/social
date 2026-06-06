import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Icon } from '@/shared/ui/Icon.js';

type VideoNoteOrbitControlIcon = 'play' | 'pause';

interface VideoNoteOrbitProps {
  children: ReactNode;
  isPlaying?: boolean;
  isRecording?: boolean;
  progressPercent?: number;
  timeLabel?: string;
  controlIcon?: VideoNoteOrbitControlIcon;
  showControl?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  tabIndex?: number;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

type VideoNoteOrbitStyle = CSSProperties & {
  '--video-note-progress': string;
};

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

export function VideoNoteOrbit({
  children,
  isPlaying = false,
  isRecording = false,
  progressPercent = 0,
  timeLabel,
  controlIcon,
  showControl = true,
  disabled = false,
  className = '',
  ariaLabel,
  title,
  tabIndex,
  onClick,
}: VideoNoteOrbitProps) {
  const progressDegrees = clampProgress(progressPercent) * 3.6;
  const rootClassName = [
    'video-note-orbit',
    isPlaying ? 'video-note-orbit--playing' : '',
    isRecording ? 'video-note-orbit--recording' : '',
    disabled ? 'video-note-orbit--disabled' : '',
    className,
  ].filter(Boolean).join(' ');
  const style: VideoNoteOrbitStyle = {
    '--video-note-progress': `${progressDegrees}deg`,
  };

  const content = (
    <>
      <span className="video-note-orbit__glow" aria-hidden="true" />
      <span className="video-note-orbit__track" aria-hidden="true" />
      <span className="video-note-orbit__progress" aria-hidden="true" />
      <span className="video-note-orbit__media">
        {children}
        <span className="video-note-orbit__vignette" aria-hidden="true" />
      </span>
      {showControl && controlIcon && (
        <span className="video-note-orbit__control" aria-hidden="true">
          <Icon
            name={controlIcon}
            className={controlIcon === 'play' ? 'ml-0.5 h-4 w-4' : 'h-4 w-4'}
            filled
          />
        </span>
      )}
      {timeLabel && (
        <span className="video-note-orbit__duration">
          {timeLabel}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={rootClassName}
        style={style}
        aria-label={ariaLabel}
        title={title}
        tabIndex={tabIndex}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={rootClassName} style={style} title={title}>
      {content}
    </div>
  );
}
