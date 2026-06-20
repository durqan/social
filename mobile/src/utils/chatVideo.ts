import { Video } from 'react-native-compressor';
import { CHAT_VIDEO_MAX_BYTES } from '../config/env';
import type { LocalChatVideo } from '../api/messages';

export const CHAT_VIDEO_SOURCE_MAX_BYTES = 500 * 1024 * 1024;

export async function compressLocalChatVideo(
  video: LocalChatVideo,
  onStage?: (stage: 'preparing' | 'compressing') => void,
): Promise<LocalChatVideo> {
  onStage?.('preparing');
  if (video.fileSize && video.fileSize > CHAT_VIDEO_SOURCE_MAX_BYTES) {
    throw new Error('Исходное видео должно быть не больше 500 МБ');
  }
  if (video.fileSize && video.fileSize <= 20 * 1024 * 1024) {
    return video;
  }

  onStage?.('compressing');
  const compressedUri = await Video.compress(video.uri, {
    compressionMethod: 'auto',
    maxSize: 720,
    minimumFileSizeForCompress: 20,
  });

  const compressed: LocalChatVideo = {
    ...video,
    uri: compressedUri,
    type: 'video/mp4',
    fileName: video.fileName.replace(/\.[^.]+$/, '') + '.mp4',
  };

  if (compressed.fileSize && compressed.fileSize > CHAT_VIDEO_MAX_BYTES) {
    throw new Error('Видео слишком большое после сжатия. Попробуйте выбрать более короткий ролик.');
  }

  return compressed;
}
