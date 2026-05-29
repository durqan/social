import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { assetURL, CHAT_IMAGE_MAX_COUNT, CHAT_IMAGE_MIME_TYPES } from '../../config/env';
import { getApiErrorMessage } from '../../api/http';
import {
  messageApi,
  validateLocalChatImage,
  type LocalChatImage,
} from '../../api/messages';
import type { Message, MessageAttachment } from '../../api/types';
import { chatSocket, type WsEvent } from '../../api/ws';
import { AppButton } from '../../components/AppButton';
import { ErrorBanner } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;

export default function ChatScreen({ route }: Props) {
  const { user } = useAuth();
  const otherUserId = route.params.userId;
  const listRef = useRef<FlatList<Message>>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<LocalChatImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await messageApi.getMessagesWith(otherUserId, {
        limit: 50,
      });
      setMessages(response.messages);
      await messageApi.markAsRead(otherUserId);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, [otherUserId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages().catch(() => undefined);
    }, [loadMessages]),
  );

  const handleSocketEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === 'message:error') {
        const payload = event.payload as { error: string };
        setError(getApiErrorMessage(new Error(payload.error)));
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

      setMessages(previous => {
        if (previous.some(item => item.id === message.id)) {
          return previous;
        }
        return [...previous, message];
      });

      if (message.from_id === otherUserId) {
        messageApi.markAsRead(otherUserId).catch(() => undefined);
        chatSocket.sendReadReceipt(otherUserId);
      }
    },
    [otherUserId, user?.id],
  );

  useEffect(() => {
    const unsubscribeMessages = chatSocket.onMessage(handleSocketEvent);
    const unsubscribeStatus = chatSocket.onStatus(setWsConnected);
    chatSocket.connect();

    return () => {
      unsubscribeMessages();
      unsubscribeStatus();
    };
  }, [handleSocketEvent]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  async function pickImages() {
    const remaining = CHAT_IMAGE_MAX_COUNT - pendingImages.length;
    if (remaining <= 0) {
      setError(`Можно прикрепить не больше ${CHAT_IMAGE_MAX_COUNT} изображений`);
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: remaining,
      restrictMimeTypes: [...CHAT_IMAGE_MIME_TYPES],
      includeExtra: true,
    });

    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError(result.errorMessage);
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

    setSending(true);
    setError(null);
    try {
      const attachments: MessageAttachment[] = [];
      for (const image of pendingImages) {
        attachments.push(await messageApi.uploadImage(image));
      }

      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(otherUserId, trimmed, attachments);
      } else {
        const sent = await messageApi.sendMessage(otherUserId, trimmed, attachments);
        setMessages(previous => [...previous, sent]);
      }

      setInput('');
      setPendingImages([]);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setSending(false);
    }
  }

  function removePendingImage(id: string) {
    setPendingImages(previous => previous.filter(image => image.id !== id));
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <View style={styles.socketBar}>
        <Text style={styles.socketText}>
          {wsConnected ? 'Realtime подключен' : 'REST режим, realtime недоступен'}
        </Text>
      </View>

      <ErrorBanner message={error} />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              outgoing={item.from_id === user?.id}
            />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>Сообщений пока нет</Text>
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
                onPress={() => removePendingImage(image.id)}>
                <Text style={styles.previewRemoveText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.composer}>
        <AppButton title="Фото" variant="secondary" onPress={pickImages} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Сообщение"
          placeholderTextColor={colors.soft}
          multiline
          maxLength={1000}
          style={styles.input}
        />
        <AppButton title="Отпр." loading={sending} onPress={sendMessage} />
      </View>
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
}: {
  message: Message;
  outgoing: boolean;
}) {
  return (
    <View style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}>
      <View style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}>
        {message.content ? (
          <Text style={[styles.messageText, outgoing && styles.outgoingText]}>
            {message.content}
          </Text>
        ) : null}

        {message.attachments?.map(attachment => (
          <Image
            key={attachment.id ?? attachment.file_url}
            source={{ uri: assetURL(attachment.file_url) }}
            style={styles.messageImage}
            resizeMode="cover"
          />
        ))}

        <Text style={[styles.messageDate, outgoing && styles.outgoingDate]}>
          {formatDateTime(message.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
  },
  socketBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  socketText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageList: {
    padding: 16,
    gap: 8,
    flexGrow: 1,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
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
});
