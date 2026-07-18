import type { TrackReference } from '@livekit/react-native';

export type CallType = 'audio' | 'video';

export type CallStatus =
  | 'idle'
  | 'incoming'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'reconnecting'
  | 'ended'
  | 'error';

export type LiveKitMediaState = {
  connectionState:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'failed';
  localVideoTrack?: TrackReference;
  remoteVideoTrack?: TrackReference;
  microphoneOn: boolean;
  cameraOn: boolean;
  speakerphoneOn: boolean;
  frontCamera: boolean;
  error: string | null;
};
