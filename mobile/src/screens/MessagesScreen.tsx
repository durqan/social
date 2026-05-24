import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { apiAssetURL, authHeaders } from '../api/client';
import { messageApi } from '../api/services';
import { Button, Card, EmptyState, Field, Screen } from '../components/ui';
import { wsService } from '../services/ws';
import type { Conversation, Message, MessageAttachment } from '../types';
import { alertError } from '../utils/errors';

const formatMessageTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function MessageBubble({
  message,
  activeUserId,
  imageHeaders,
}: {
  message: Message;
  activeUserId: number;
  imageHeaders?: Record<string, string>;
}) {
  const isOwn = message.from_id !== activeUserId;

  return (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
      {message.attachments?.map(attachment => {
        const uri = apiAssetURL(attachment.file_url);
        if (!uri) return null;
        return (
          <Image
            key={attachment.id || attachment.file_url}
            source={{ uri, headers: imageHeaders }}
            style={styles.messageImage}
            resizeMode="cover"
          />
        );
      })}
      {message.content ? (
        <Text style={[styles.messageText, isOwn && styles.messageTextOwn]}>{message.content}</Text>
      ) : null}
      <View style={styles.messageMetaRow}>
        <Text style={[styles.messageTime, isOwn && styles.messageTimeOwn]}>
          {formatMessageTime(message.created_at)}
        </Text>
        {isOwn && <Text style={styles.readMark}>{message.is_read ? '✓✓' : '✓'}</Text>}
      </View>
    </View>
  );
}

export function MessagesScreen({
  requestedChat,
  onRequestedChatHandled,
}: {
  requestedChat?: Conversation | null;
  onRequestedChatHandled?: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [imageHeaders, setImageHeaders] = useState<Record<string, string> | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const loadConversations = useCallback(async () => {
    setConversations(await messageApi.conversations());
  }, []);

  useEffect(() => {
    loadConversations().catch(console.error);
  }, [loadConversations]);

  useEffect(() => {
    if (!requestedChat) return;
    openChat(requestedChat).finally(() => onRequestedChatHandled?.());
  }, [requestedChat]);

  useEffect(() => {
    authHeaders().then(setImageHeaders).catch(() => undefined);
  }, []);

  useEffect(() => {
    return wsService.onMessage(event => {
      if (event.type !== 'message:new') return;
      const message = event.payload;
      setMessages(current => (current.some(item => item.id === message.id) ? current : [...current, message]));
      loadConversations().catch(() => undefined);
    });
  }, [loadConversations]);

  const openChat = async (conversation: Conversation) => {
    setActive(conversation);
    const data = await messageApi.withUser(conversation.user_id);
    setMessages(data.messages);
    await messageApi.markRead(conversation.user_id).catch(() => undefined);
  };

  const send = async () => {
    if (!active || (!text.trim() && pendingAttachments.length === 0)) return;
    try {
      const message = await messageApi.send(active.user_id, text.trim(), pendingAttachments);
      setMessages(current => [...current, message]);
      setText('');
      setPendingAttachments([]);
      await loadConversations();
    } catch (error) {
      alertError(error, 'Не удалось отправить сообщение');
    }
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к фото, чтобы отправить изображение');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });

    if (result.canceled) return;

    try {
      const uploaded = await messageApi.uploadImage(result.assets[0].uri);
      setPendingAttachments(current => [...current, uploaded]);
    } catch (error) {
      alertError(error, 'Не удалось загрузить изображение');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (active) {
        await openChat(active);
      } else {
        await loadConversations();
      }
    } finally {
      setRefreshing(false);
    }
  };

  if (active) {
    return (
      <Screen>
        <View style={styles.chatHeader}>
          <Button title="Назад" variant="secondary" onPress={() => setActive(null)} />
          <Text style={styles.chatTitle}>{active.name}</Text>
        </View>
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.messages}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          data={messages}
          keyExtractor={item => String(item.id)}
          ListEmptyComponent={<EmptyState text="Сообщений пока нет" />}
          renderItem={({ item }) => (
            <MessageBubble message={item} activeUserId={active.user_id} imageHeaders={imageHeaders} />
          )}
        />
        <View style={styles.composer}>
          {pendingAttachments.length > 0 && (
            <Text style={styles.pending}>{pendingAttachments.length} изображение готово к отправке</Text>
          )}
          <Field value={text} onChangeText={setText} placeholder="Сообщение" />
          <Button title="Фото" variant="secondary" onPress={pickImage} />
          <Button title="Отправить" onPress={send} />
        </View>
      </Screen>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={<Text style={styles.title}>Сообщения</Text>}
      data={conversations}
      keyExtractor={item => String(item.user_id)}
      ListEmptyComponent={<EmptyState text="Диалогов пока нет" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => openChat(item)}>
          <Card>
            <View style={styles.conversationTop}>
              <Text style={styles.name}>{item.name}</Text>
              {item.unread_count > 0 && <Text style={styles.badge}>{item.unread_count}</Text>}
            </View>
            <Text style={styles.last}>{item.last_message || 'Вложение'}</Text>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 2,
  },
  conversationTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
  },
  last: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 6,
  },
  badge: {
    minWidth: 24,
    borderRadius: 12,
    backgroundColor: '#0284c7',
    color: '#ffffff',
    overflow: 'hidden',
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontWeight: '800',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  chatTitle: {
    flex: 1,
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },
  messages: {
    padding: 14,
    gap: 8,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#0284c7',
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  messageText: {
    color: '#111827',
    fontSize: 15,
  },
  messageTextOwn: {
    color: '#ffffff',
  },
  messageMetaRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  messageTime: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  messageTimeOwn: {
    color: '#dbeafe',
  },
  readMark: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '900',
  },
  messageImage: {
    width: 210,
    height: 160,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#e5e7eb',
  },
  pending: {
    color: '#0369a1',
    fontSize: 13,
    fontWeight: '800',
  },
  composer: {
    gap: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
});
