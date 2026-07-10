import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';

import { DiagnosticVideo } from '../../../components/DiagnosticVideo';
import { styles } from '../lib/chatStyles';

type ChatLightboxesProps = {
  imageUrl: string | null;
  videoUrl: string | null;
  onCloseImage: () => void;
  onCloseVideo: () => void;
};

export function ChatLightboxes({
  imageUrl,
  videoUrl,
  onCloseImage,
  onCloseVideo,
}: ChatLightboxesProps) {
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);
  const videoSource = useMemo(
    () => (videoUrl ? { uri: videoUrl } : null),
    [videoUrl],
  );

  useEffect(() => {
    setVideoPlaybackError(false);
  }, [videoUrl]);

  return (
    <>
      <Modal
        visible={Boolean(imageUrl)}
        transparent
        animationType="fade"
        onRequestClose={onCloseImage}
      >
        <Pressable style={styles.lightbox} onPress={onCloseImage}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.lightboxClose}
            onPress={onCloseImage}
          >
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(videoUrl)}
        transparent
        animationType="fade"
        onRequestClose={onCloseVideo}
      >
        <View style={styles.lightbox}>
          <Pressable style={styles.lightboxBackdrop} onPress={onCloseVideo} />
          {videoSource ? (
            <DiagnosticVideo
              source={videoSource}
              style={styles.lightboxVideo}
              controls
              resizeMode="contain"
              diagnosticLabel="chat-video-lightbox"
              onError={() => setVideoPlaybackError(true)}
            />
          ) : null}
          {videoPlaybackError ? (
            <View pointerEvents="none" style={styles.lightboxVideoError}>
              <Text style={styles.lightboxVideoErrorText}>
                Не удалось воспроизвести видео. Подробности записаны в лог приложения.
              </Text>
            </View>
          ) : null}
          <Pressable style={styles.lightboxClose} onPress={onCloseVideo}>
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
