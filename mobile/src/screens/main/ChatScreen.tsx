import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import {
  assetURL,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MIME_TYPES,
} from '../../config/env';
import { getApiErrorMessage } from '../../api/http';
import {
  messageApi,
  validateLocalChatImage,
  type LocalChatImage,
} from '../../api/messages';
import type { Message, MessageAttachment } from '../../api/types';
import { chatSocket, type WsEvent } from '../../api/ws';
import { AppButton } from '../../components/AppButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAppLifecycle } from '../../context/AppLifecycleContext';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useUnread } from '../../context/UnreadContext';
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;
type LoadMode = 'initial' | 'refresh' | 'silent';

export default function ChatScreen({ route }: Props) {
  const { user } = useAuth();
  const { startAudioCall, startVideoCall, status: callStatus } = useCall();
  const isFocused = useIsFocused();
  const { networkConnected, resumeCount } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const otherUserId = route.params.userId;
  const listRef = useRef<FlatList<Message>>(null);
  const hasLoadedRef = useRef(false);
  const draftRef = useRef<{
    input: string;
    pendingImages: LocalChatImage[];
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<LocalChatImage[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sending, setSending] = useState<'uploading' | 'sending' | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markConversationRead = useCallback(async () => {
    await messageApi.markAsRead(otherUserId);
    refreshUnreadCount().catch(() => undefined);
    signalChatDataChanged();
    setMessages(previous =>
      previous.map(message =>
        message.from_id === otherUserId && message.to_id === user?.id
          ? {
              ...message,
              is_read: true,
            }
          : message,
      ),
    );
  }, [otherUserId, refreshUnreadCount, signalChatDataChanged, user?.id]);

  const loadMessages = useCallback(
    async (mode: LoadMode = 'initial') => {
      const showInitialLoading = mode === 'initial' && !hasLoadedRef.current;

      if (showInitialLoading) {
        setLoading(true);
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }

      setError(null);
      try {
        const response = await messageApi.getMessagesWith(otherUserId, {
          limit: 50,
        });
        setMessages(response.messages);
        markConversationRead().catch(() => undefined);
      } catch (apiError) {
        setError(getApiErrorMessage(apiError));
      } finally {
        hasLoadedRef.current = true;
        setHasLoaded(true);
        if (showInitialLoading) {
          setLoading(false);
        }
        if (mode === 'refresh') {
          setRefreshing(false);
        }
      }
    },
    [markConversationRead, otherUserId],
  );

  useFocusEffect(
    useCallback(() => {
      loadMessages().catch(() => undefined);
    }, [loadMessages]),
  );

  useEffect(() => {
    if (!isFocused || resumeCount === 0) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
  }, [isFocused, loadMessages, resumeCount]);

  useEffect(() => {
    if (!isFocused || !networkConnected) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
  }, [isFocused, loadMessages, networkConnected]);

  const restoreDraftAfterSendError = useCallback(() => {
    if (!draftRef.current) {
      return;
    }

    setInput(draftRef.current.input);
    setPendingImages(draftRef.current.pendingImages);
    draftRef.current = null;
  }, []);

  const handleSocketEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === 'message:error') {
        const payload = event.payload as { error: string };
        restoreDraftAfterSendError();
        setError(getApiErrorMessage(new Error(payload.error)));
        return;
      }

      if (event.type === 'message:read') {
        const payload = event.payload as { from_id: number; to_id: number };
        refreshUnreadCount().catch(() => undefined);
        setMessages(previous =>
          previous.map(message =>
            message.from_id === payload.to_id &&
            message.to_id === payload.from_id
              ? {
                  ...message,
                  is_read: true,
                }
              : message,
          ),
        );
        return;
      }

      if (event.type !== 'message:new') {
        return;
      }

      const message = event.payload as Message;
      const belongsToChat =
        (message.from_id === otherUserId && message.to_id === user?.id) ||
        (message.to_id === otherUserId && message.from_id === user?.id);

      if (!belongsToChat) {
        return;
      }

      if (message.from_id === user?.id && message.to_id === otherUserId) {
        draftRef.current = null;
      }

      setMessages(previous => {
        if (previous.some(item => item.id === message.id)) {
          return previous;
        }
        return [...previous, message];
      });

      if (message.from_id === otherUserId) {
        markConversationRead().catch(() => undefined);
      }
    },
    [
      markConversationRead,
      otherUserId,
      refreshUnreadCount,
      restoreDraftAfterSendError,
      user?.id,
    ],
  );

  useEffect(() => {
    const unsubscribeMessages = chatSocket.onMessage(handleSocketEvent);
    chatSocket.connect();

    return () => {
      unsubscribeMessages();
    };
  }, [handleSocketEvent]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() =>
        listRef.current?.scrollToEnd({ animated: true }),
      );
    }
  }, [messages.length]);

  async function pickImages() {
    const remaining = CHAT_IMAGE_MAX_COUNT - pendingImages.length;
    if (remaining <= 0) {
      setError(
        `Можно прикрепить не больше ${CHAT_IMAGE_MAX_COUNT} изображений`,
      );
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: remaining,
      restrictMimeTypes: [...CHAT_IMAGE_MIME_TYPES],
      includeExtra: true,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.8,
    });

    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError('Не удалось выбрать изображение. Попробуйте еще раз.');
      return;
    }

    const images = (result.assets || [])
      .map(assetToLocalImage)
      .filter((image): image is LocalChatImage => Boolean(image));
    const firstError = images.map(validateLocalChatImage).find(Boolean);

    if (firstError) {
      setError(firstError);
      return;
    }

    setError(null);
    setPendingImages(previous =>
      [...previous, ...images].slice(0, CHAT_IMAGE_MAX_COUNT),
    );
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed && pendingImages.length === 0) {
      setError('Введите сообщение или выберите изображение');
      return;
    }

    let uploadFailed = false;
    setSending(pendingImages.length > 0 ? 'uploading' : 'sending');
    setUploadProgress(
      pendingImages.length > 0
        ? {
            current: 0,
            total: pendingImages.length,
          }
        : null,
    );
    setError(null);
    try {
      const attachments: MessageAttachment[] = [];
      for (const [index, image] of pendingImages.entries()) {
        try {
          attachments.push(await messageApi.uploadImage(image));
          setUploadProgress({
            current: index + 1,
            total: pendingImages.length,
          });
        } catch (apiError) {
          uploadFailed = true;
          throw apiError;
        }
      }

      setSending('sending');
      setUploadProgress(null);

      draftRef.current = {
        input,
        pendingImages,
      };

      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(otherUserId, trimmed, attachments);
      } else {
        const sent = await messageApi.sendMessage(
          otherUserId,
          trimmed,
          attachments,
        );
        draftRef.current = null;
        setMessages(previous => [...previous, sent]);
        signalChatDataChanged();
      }

      setInput('');
      setPendingImages([]);
    } catch (apiError) {
      const message = getApiErrorMessage(apiError);
      setError(
        uploadFailed
          ? `${message} Удалите изображение из предпросмотра или попробуйте отправить снова.`
          : message,
      );
    } finally {
      setSending(null);
      setUploadProgress(null);
    }
  }

  function removePendingImage(id: string) {
    setPendingImages(previous => previous.filter(image => image.id !== id));
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />

      <View style={styles.callActions}>
        <AppButton
          title="Аудио"
          variant="secondary"
          disabled={callStatus !== 'idle'}
          onPress={() => startAudioCall(otherUserId, route.params.name)}
        />
        <AppButton
          title="Видео"
          variant="secondary"
          disabled={callStatus !== 'idle'}
          onPress={() => startVideoCall(otherUserId, route.params.name)}
        />
      </View>

      {loading && !hasLoaded ? (
        <View style={styles.loading}>
          <LoadingState text="Загружаем сообщения" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => String(item.id)}
          refreshing={refreshing}
          onRefresh={() => loadMessages('refresh')}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              outgoing={item.from_id === user?.id}
              onImagePress={setSelectedImageUrl}
            />
          )}
          contentContainerStyle={[
            styles.messageList,
            messages.length === 0 && styles.emptyMessageList,
          ]}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <EmptyState
              title="Сообщений пока нет"
              text="Напишите первым или отправьте изображение."
            />
          }
        />
      )}

      {pendingImages.length > 0 ? (
        <View style={styles.previewStrip}>
          {pendingImages.map(image => (
            <View key={image.id} style={styles.previewItem}>
              <Image source={{ uri: image.uri }} style={styles.previewImage} />
              <Pressable
                accessibilityRole="button"
                style={styles.previewRemove}
                onPress={() => removePendingImage(image.id)}
              >
                <Text style={styles.previewRemoveText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {sending ? (
        <View style={styles.sendStatus}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.sendStatusText}>
            {sending === 'uploading'
              ? uploadProgress
                ? `Загружаем изображения: ${uploadProgress.current} из ${uploadProgress.total}`
                : 'Загружаем изображение'
              : 'Отправляем сообщение'}
          </Text>
        </View>
      ) : null}

      <View style={styles.composer}>
        <AppButton
          title="Фото"
          variant="secondary"
          disabled={Boolean(sending)}
          onPress={pickImages}
        />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Сообщение"
          placeholderTextColor={colors.soft}
          multiline
          maxLength={1000}
          editable={!sending}
          style={styles.input}
        />
        <AppButton
          title="Отправить"
          disabled={
            Boolean(sending) || (!input.trim() && pendingImages.length === 0)
          }
          loading={Boolean(sending)}
          onPress={sendMessage}
        />
      </View>

      <Modal
        visible={Boolean(selectedImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <Pressable
          style={styles.lightbox}
          onPress={() => setSelectedImageUrl(null)}
        >
          {selectedImageUrl ? (
            <Image
              source={{ uri: selectedImageUrl }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.lightboxClose}
            onPress={() => setSelectedImageUrl(null)}
          >
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function assetToLocalImage(asset: Asset): LocalChatImage | null {
  if (!asset.uri || !asset.type) {
    return null;
  }

  return {
    id: `${asset.uri}-${asset.fileSize ?? Date.now()}`,
    uri: asset.uri,
    type: asset.type,
    fileName: asset.fileName || `chat-image-${Date.now()}.jpg`,
    fileSize: asset.fileSize,
  };
}

function MessageBubble({
  message,
  outgoing,
  onImagePress,
}: {
  message: Message;
  outgoing: boolean;
  onImagePress: (url: string) => void;
}) {
  return (
    <View style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}>
      <View
        style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}
      >
        {message.content ? (
          <Text style={[styles.messageText, outgoing && styles.outgoingText]}>
            {message.content}
          </Text>
        ) : null}

        {message.attachments?.map(attachment => {
          const imageUrl = assetURL(attachment.file_url);
          return (
            <Pressable
              key={attachment.id ?? attachment.file_url}
              accessibilityRole="imagebutton"
              onPress={() => onImagePress(imageUrl)}
            >
              <Image
                source={{ uri: imageUrl }}
                style={styles.messageImage}
                resizeMode="cover"
              />
            </Pressable>
          );
        })}

        <Text style={[styles.messageDate, outgoing && styles.outgoingDate]}>
          {formatDateTime(message.created_at)}
        </Text>
        {outgoing ? (
          <Text style={styles.outgoingStatus}>
            {message.is_read ? 'Прочитано' : 'Отправлено'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  callActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  messageList: {
    padding: 16,
    gap: 8,
    flexGrow: 1,
  },
  emptyMessageList: {
    justifyContent: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 14,
    padding: 10,
    gap: 6,
  },
  incoming: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outgoing: {
    backgroundColor: colors.accent,
  },
  messageText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  outgoingText: {
    color: '#ffffff',
  },
  messageDate: {
    color: colors.soft,
    fontSize: 11,
    alignSelf: 'flex-end',
  },
  outgoingDate: {
    color: 'rgba(255, 255, 255, 0.78)',
  },
  outgoingStatus: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 11,
    lineHeight: 14,
    alignSelf: 'flex-end',
  },
  messageImage: {
    width: 210,
    height: 150,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  previewStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewItem: {
    width: 64,
    height: 64,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  previewRemove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  previewRemoveText: {
    color: '#ffffff',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
  },
  sendStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  sendStatusText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 15,
  },
  lightbox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 14,
  },
  lightboxImage: {
    width: '100%',
    height: '86%',
  },
  lightboxClose: {
    position: 'absolute',
    right: 18,
    top: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  lightboxCloseText: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '600',
  },
});
