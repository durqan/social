import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

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
  const insets = useSafeAreaInsets();
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);
  const videoSource = useMemo(
    () => (videoUrl ? { uri: videoUrl } : null),
    [videoUrl],
  );

  useEffect(() => {
    setVideoPlaybackError(false);
  }, [videoUrl]);

  const lightboxInsetsStyle = {
    paddingTop: Math.max(insets.top, 14),
    paddingRight: Math.max(insets.right, 14),
    paddingBottom: Math.max(insets.bottom, 14),
    paddingLeft: Math.max(insets.left, 14),
  };
  const closeInsetsStyle = {
    top: Math.max(insets.top, 12),
    right: Math.max(insets.right, 12),
  };

  return (
    <>
      <Modal
        visible={Boolean(imageUrl)}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onCloseImage}
      >
        <Pressable
          accessibilityViewIsModal
          style={[styles.lightbox, lightboxInsetsStyle]}
          onPress={onCloseImage}
        >
          {imageUrl ? (
            <Image
              accessible
              accessibilityRole="image"
              accessibilityLabel="Изображение из сообщения"
              source={{ uri: imageUrl }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть изображение"
            style={[styles.lightboxClose, closeInsetsStyle]}
            onPress={onCloseImage}
          >
            <X color="#FFFFFF" size={24} strokeWidth={2.5} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(videoUrl)}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onCloseVideo}
      >
        <View
          accessibilityViewIsModal
          style={[styles.lightbox, lightboxInsetsStyle]}
        >
          <Pressable
            accessible={false}
            style={styles.lightboxBackdrop}
            onPress={onCloseVideo}
          />
          {videoSource ? (
            <DiagnosticVideo
              accessible
              accessibilityLabel="Видео из сообщения"
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть видео"
            style={[styles.lightboxClose, closeInsetsStyle]}
            onPress={onCloseVideo}
          >
            <X color="#FFFFFF" size={24} strokeWidth={2.5} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
