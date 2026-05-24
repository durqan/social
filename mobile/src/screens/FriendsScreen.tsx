import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { friendApi, userApi } from '../api/services';
import { Button, Card, EmptyState, Field } from '../components/ui';
import type { Conversation, Friendship, User } from '../types';
import { alertError } from '../utils/errors';

export function FriendsScreen({ onOpenChat }: { onOpenChat: (conversation: Conversation) => void }) {
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<Friendship[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [friendList, requestList] = await Promise.all([friendApi.list(), friendApi.requests()]);
    setFriends(friendList);
    setRequests(requestList);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    try {
      setResults(await userApi.search(query.trim()));
    } catch (error) {
      alertError(error, 'Поиск не удался');
    }
  };

  const accept = async (request: Friendship) => {
    await friendApi.accept(request.id);
    await load();
  };

  const sendRequest = async (user: User) => {
    if (!user.id) return;
    try {
      await friendApi.send(user.id);
      Alert.alert('Готово', 'Заявка отправлена');
    } catch (error) {
      alertError(error, 'Не удалось отправить заявку');
    }
  };

  const openChat = (user: User) => {
    if (!user.id) return;
    onOpenChat({
      user_id: user.id,
      name: user.name || user.email,
      last_message: '',
      last_message_at: '',
      unread_count: 0,
    });
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <View style={styles.stack}>
          <Card>
            <Text style={styles.title}>Друзья</Text>
            <View style={styles.search}>
              <Field value={query} onChangeText={setQuery} placeholder="Найти пользователя" />
              <Button title="Найти" onPress={search} />
            </View>
          </Card>

          {requests.length > 0 && (
            <Card>
              <Text style={styles.section}>Заявки</Text>
              {requests.map(request => (
                <View key={request.id} style={styles.row}>
                  <Text style={styles.name}>{request.user?.name || request.user?.email || 'Пользователь'}</Text>
                  <Button title="Принять" onPress={() => accept(request)} />
                </View>
              ))}
            </Card>
          )}

          {results.length > 0 && (
            <Card>
              <Text style={styles.section}>Результаты поиска</Text>
              {results.map(user => (
                <View key={user.id || user.email} style={styles.row}>
                  <Text style={styles.name}>{user.name || user.email}</Text>
                  <Button title="Добавить" variant="secondary" onPress={() => sendRequest(user)} />
                </View>
              ))}
            </Card>
          )}
        </View>
      }
      data={friends}
      keyExtractor={item => String(item.id || item.email)}
      ListEmptyComponent={<EmptyState text="Список друзей пуст" />}
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.name}>{item.name || item.email}</Text>
          <Text style={styles.email}>{item.email}</Text>
          <View style={styles.messageAction}>
            <Button title="Написать" onPress={() => openChat(item)} />
          </View>
        </Card>
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
  stack: {
    gap: 12,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 12,
  },
  search: {
    gap: 10,
  },
  section: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  row: {
    gap: 8,
    marginBottom: 12,
  },
  name: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  email: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 3,
  },
  messageAction: {
    marginTop: 12,
  },
});
