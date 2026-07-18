import { Platform } from 'react-native';
import {
  AudioSession,
  type TrackReference,
} from '@livekit/react-native';
import {
  ConnectionState,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';

import type { LiveKitMediaState } from './types';

type MediaListener = (state: LiveKitMediaState) => void;

const initialMediaState: LiveKitMediaState = {
  connectionState: 'disconnected',
  localVideoTrack: undefined,
  remoteVideoTrack: undefined,
  microphoneOn: true,
  cameraOn: false,
  speakerphoneOn: false,
  frontCamera: true,
  error: null,
};

export class LiveKitCall {
  private room: Room | null = null;
  private generation = 0;
  private cleanupPromise: Promise<void> | null = null;
  private listeners = new Set<MediaListener>();
  private state: LiveKitMediaState = initialMediaState;

  subscribe(listener: MediaListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  isConnected() {
    return this.room?.state === ConnectionState.Connected;
  }

  async connect({
    serverURL,
    token,
    video,
    speakerphoneOn,
  }: {
    serverURL: string;
    token: string;
    video: boolean;
    speakerphoneOn: boolean;
  }) {
    await this.disconnect();
    const generation = ++this.generation;
    const room = new Room({
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: true,
    });
    this.room = room;
    this.bindRoom(room, generation);
    this.update({
      ...initialMediaState,
      connectionState: 'connecting',
      speakerphoneOn,
      cameraOn: video,
    });

    try {
      await AudioSession.startAudioSession();
      await room.connect(serverURL, token, { autoSubscribe: true });
      if (!this.isCurrent(room, generation)) {
        await room.disconnect(true);
        return;
      }

      await room.localParticipant.setMicrophoneEnabled(true);
      if (video) {
        await room.localParticipant.setCameraEnabled(true, {
          facingMode: 'user',
        });
      }
      await this.selectSpeakerphone(speakerphoneOn);
      this.refreshTracks();
      this.update({
        connectionState: 'connected',
        error: null,
      });
    } catch (error) {
      if (this.isCurrent(room, generation)) {
        await this.disconnect();
        this.update({
          connectionState: 'failed',
          error: errorMessage(error),
        });
      }
      throw error;
    }
  }

  async setMicrophoneOn(enabled: boolean) {
    const room = this.room;
    if (!room) {
      return;
    }
    await room.localParticipant.setMicrophoneEnabled(enabled);
    this.update({ microphoneOn: enabled });
  }

  async setCameraOn(enabled: boolean) {
    const room = this.room;
    if (!room) {
      return;
    }
    await room.localParticipant.setCameraEnabled(enabled, {
      facingMode: this.state.frontCamera ? 'user' : 'environment',
    });
    this.refreshTracks();
    this.update({ cameraOn: enabled });
  }

  async switchCamera() {
    const room = this.room;
    const frontCamera = !this.state.frontCamera;
    if (!room || !this.state.cameraOn) {
      this.update({ frontCamera });
      return;
    }

    const publication = Array.from(
      room.localParticipant.videoTrackPublications.values(),
    ).find(candidate => candidate.source === Track.Source.Camera);
    const track = publication?.videoTrack;
    if (track instanceof LocalVideoTrack) {
      await track.restartTrack({
        facingMode: frontCamera ? 'user' : 'environment',
      });
    }
    this.refreshTracks();
    this.update({ frontCamera });
  }

  async setSpeakerphoneOn(enabled: boolean) {
    await this.selectSpeakerphone(enabled);
    this.update({ speakerphoneOn: enabled });
  }

  async disconnect() {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    const room = this.room;
    this.room = null;
    this.generation += 1;
    this.cleanupPromise = (async () => {
      try {
        if (room) {
          room.removeAllListeners();
          await room.disconnect(true);
        }
      } finally {
        await AudioSession.stopAudioSession().catch(() => undefined);
        this.update(initialMediaState);
      }
    })().finally(() => {
      this.cleanupPromise = null;
    });

    return this.cleanupPromise;
  }

  private bindRoom(room: Room, generation: number) {
    const refresh = () => {
      if (this.isCurrent(room, generation)) {
        this.refreshTracks();
      }
    };

    room.on(RoomEvent.ConnectionStateChanged, state => {
      if (!this.isCurrent(room, generation)) {
        return;
      }
      this.update({
        connectionState: mapConnectionState(state),
        error: null,
      });
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (this.isCurrent(room, generation)) {
        this.update({ connectionState: 'reconnecting' });
      }
    });
    room.on(RoomEvent.SignalReconnecting, () => {
      if (this.isCurrent(room, generation)) {
        this.update({ connectionState: 'reconnecting' });
      }
    });
    room.on(RoomEvent.Reconnected, () => {
      if (this.isCurrent(room, generation)) {
        this.refreshTracks();
        this.update({ connectionState: 'connected', error: null });
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.isCurrent(room, generation)) {
        this.update({ connectionState: 'disconnected' });
      }
    });
    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.TrackPublished, refresh);
    room.on(RoomEvent.TrackUnpublished, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);
    room.on(RoomEvent.LocalTrackPublished, refresh);
    room.on(RoomEvent.LocalTrackUnpublished, refresh);
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
  }

  private refreshTracks() {
    const room = this.room;
    if (!room) {
      this.update({
        localVideoTrack: undefined,
        remoteVideoTrack: undefined,
      });
      return;
    }

    const localPublication = Array.from(
      room.localParticipant.videoTrackPublications.values(),
    ).find(
      publication =>
        publication.source === Track.Source.Camera &&
        Boolean(publication.videoTrack),
    );
    let remoteVideoTrack: TrackReference | undefined;
    for (const participant of room.remoteParticipants.values()) {
      const publication = Array.from(
        participant.videoTrackPublications.values(),
      ).find(
        candidate =>
          candidate.source === Track.Source.Camera &&
          Boolean(candidate.videoTrack),
      );
      if (publication) {
        remoteVideoTrack = {
          participant,
          publication,
          source: Track.Source.Camera,
        };
        break;
      }
    }

    this.update({
      localVideoTrack: localPublication
        ? {
            participant: room.localParticipant,
            publication: localPublication,
            source: Track.Source.Camera,
          }
        : undefined,
      remoteVideoTrack,
      microphoneOn:
        Array.from(
          room.localParticipant.audioTrackPublications.values(),
        ).find(
          publication => publication.source === Track.Source.Microphone,
        )?.isMuted !== true,
      cameraOn: localPublication?.isMuted !== true && Boolean(localPublication),
    });
  }

  private async selectSpeakerphone(enabled: boolean) {
    const outputs = await AudioSession.getAudioOutputs();
    const preferred =
      Platform.OS === 'ios'
        ? enabled
          ? 'force_speaker'
          : 'default'
        : enabled
        ? 'speaker'
        : ['bluetooth', 'headset', 'earpiece'].find(output =>
            outputs.includes(output),
          );
    if (preferred && outputs.includes(preferred)) {
      await AudioSession.selectAudioOutput(preferred);
    }
  }

  private isCurrent(room: Room, generation: number) {
    return this.room === room && this.generation === generation;
  }

  private update(patch: Partial<LiveKitMediaState> | LiveKitMediaState) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener(this.state));
  }
}

function mapConnectionState(
  state: ConnectionState,
): LiveKitMediaState['connectionState'] {
  switch (state) {
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'LiveKit connection failed';
}

export const liveKitCall = new LiveKitCall();
