import { Video, getVideoMetaData } from 'react-native-compressor';
import { CHAT_VIDEO_MAX_BYTES } from '../config/media';

const CHAT_VIDEO_SOURCE_MAX_BYTES = 500 * 1024 * 1024;

type LocalVideoFile = {
  uri: string;
  type: string;
  fileName: string;
  fileSize?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
};

export async function compressLocalChatVideo<T extends LocalVideoFile>(
  video: T,
  onStage?: (stage: 'preparing' | 'compressing') => void,
  forceCompatibility = false,
): Promise<T> {
  onStage?.('preparing');
  if (video.fileSize && video.fileSize > CHAT_VIDEO_SOURCE_MAX_BYTES) {
    throw new Error('Исходное видео должно быть не больше 500 МБ');
  }
  if (
    !forceCompatibility &&
    video.fileSize &&
    video.fileSize <= 20 * 1024 * 1024
  ) {
    return video;
  }
  onStage?.('compressing');
  const compressedUri = await Video.compress(video.uri, {
    compressionMethod: 'auto',
    maxSize: 1280,
    minimumFileSizeForCompress: forceCompatibility ? 0 : 20,
  });

  if (!forceCompatibility && compressedUri === video.uri) {
    return video;
  }

  const metadata = await getVideoMetaData(compressedUri);

  const compressed: T = {
    ...video,
    uri: compressedUri,
    type: 'video/mp4',
    fileName: video.fileName.replace(/\.[^.]+$/, '') + '.mp4',
    fileSize: metadata.size,
    width: metadata.width,
    height: metadata.height,
    durationSeconds: metadata.duration || video.durationSeconds,
  };

  if (compressed.fileSize && compressed.fileSize > CHAT_VIDEO_MAX_BYTES) {
    throw new Error('Видео слишком большое после сжатия. Попробуйте выбрать более короткий ролик.');
  }

  return compressed;
}
