import { types as documentPickerTypes } from '@react-native-documents/picker';
import {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';

export type ComposerMediaMode = 'voice' | 'video_note';

export type SendingState =
  | 'preparingVideo'
  | 'compressingVideo'
  | 'uploading'
  | 'uploadingVoice'
  | 'uploadingVideo'
  | 'uploadingVideoNote'
  | 'sending'
  | null;

export const CHAT_INPUT_NATIVE_ID = 'chat-composer-input';
export const COMPOSER_INPUT_MIN_HEIGHT = 44;
export const COMPOSER_INPUT_MAX_HEIGHT = 112;
export const COMPOSER_ESTIMATED_DOCK_HEIGHT = 24;
export const MESSAGE_LIST_BOTTOM_GAP = 24;
export const SCROLL_TO_LATEST_BUTTON_GAP = 18;
export const MESSAGE_PAGE_SIZE = 50;
export const LOAD_OLDER_THRESHOLD = 56;
export const NEAR_LATEST_THRESHOLD = 96;
export const COPY_NOTICE_TIMEOUT_MS = 1600;
export const REMOTE_TYPING_TIMEOUT_MS = 2200;
export const LOCAL_TYPING_STOP_DELAY_MS = 1400;
export const LONG_PRESS_DELAY_MS = 260;
export const SCROLL_EVENT_THROTTLE_MS = 16;
export const MESSAGE_LIST_TAP_MOVE_THRESHOLD = 8;

export const documentPickerMimeTypes = [
  documentPickerTypes.images,
  documentPickerTypes.video,
  documentPickerTypes.audio,
  documentPickerTypes.pdf,
  documentPickerTypes.doc,
  documentPickerTypes.docx,
  documentPickerTypes.xls,
  documentPickerTypes.xlsx,
  documentPickerTypes.zip,
  documentPickerTypes.plainText,
  documentPickerTypes.json,
  documentPickerTypes.csv,
].flatMap(value => (Array.isArray(value) ? value : [value]));

export const voiceAudioSet = {
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  AudioChannels: 1,
  AudioSamplingRate: 44100,
  AudioEncodingBitRate: 64000,
} as const;
