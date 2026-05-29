import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getApiErrorMessage } from '../../api/http';
import { messageApi } from '../../api/messages';
import type { Conversation } from '../../api/types';
import { ErrorBanner, Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;

export default function ChatListScreen({ navigation }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextConversations = await messageApi.getConversations();
      setConversations(nextConversations);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  function openConversation(conversation: Conversation) {
    navigation.navigate('Chat', {
      userId: conversation.user_id,
      name: conversation.name,
    });
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />

      <FlatList
        data={conversations}
        keyExtractor={item => String(item.user_id)}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Notice
            title="Диалогов пока нет"
            text="Начать новый диалог можно из вкладки Друзья."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() => openConversation(item)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.meta}>
              <View style={styles.rowHeader}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.date}>
                  {formatDateTime(item.last_message_at)}
                </Text>
              </View>
              <Text style={styles.preview} numberOfLines={1}>
                {item.last_message || 'Изображение'}
              </Text>
            </View>
            {item.unread_count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unread_count}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 0,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  date: {
    color: colors.soft,
    fontSize: 12,
  },
  preview: {
    color: colors.muted,
    fontSize: 14,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 7,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
});
