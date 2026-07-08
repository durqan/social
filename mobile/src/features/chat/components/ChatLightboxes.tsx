import React from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import Video from 'react-native-video';

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
          {videoUrl ? (
            <Video
              source={{ uri: videoUrl }}
              style={styles.lightboxVideo}
              controls
              resizeMode="contain"
            />
          ) : null}
          <Pressable style={styles.lightboxClose} onPress={onCloseVideo}>
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
