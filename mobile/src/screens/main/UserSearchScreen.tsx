import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { friendsApi } from '../../api/friends';
import { getApiErrorMessage } from '../../api/http';
import type { Friendship, User } from '../../api/types';
import { userApi } from '../../api/users';
import { assetURL } from '../../config/env';
import { AppButton } from '../../components/AppButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { avatarImageStyle } from '../../utils/avatar';
import type { MainStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'UserSearch'>;
type FriendshipStatus = Friendship['status'] | 'none';

export default function UserSearchScreen({ navigation }: Props) {
  const { user: currentUser } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [statuses, setStatuses] = useState<Record<number, FriendshipStatus>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setStatuses({});
      setError(null);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      try {
        const users = (await userApi.searchUsers(trimmed)).filter(
          item => item.id !== currentUser?.id,
        );
        if (!active) {
          return;
        }

        setResults(users);
        const nextStatuses: Record<number, FriendshipStatus> = {};
        await Promise.all(
          users.map(async item => {
            if (!item.id) {
              return;
            }
            nextStatuses[item.id] = await friendsApi.getFriendshipStatus(
              item.id,
            );
          }),
        );
        if (active) {
          setStatuses(nextStatuses);
        }
      } catch (apiError) {
        if (active) {
          setError(getApiErrorMessage(apiError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currentUser?.id, query]);

  async function sendRequest(target: User) {
    if (!target.id) {
      return;
    }

    setBusyId(target.id);
    setError(null);
    setSuccess(null);
    try {
      await friendsApi.sendFriendRequest(target.id);
      setStatuses(previous => ({
        ...previous,
        [target.id as number]: 'pending',
      }));
      setSuccess('Заявка отправлена.');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyId(null);
    }
  }

  function openProfile(target: User) {
    if (!target.id) {
      return;
    }

    navigation.navigate('UserProfile', {
      userId: target.id,
      name: target.name || 'Пользователь',
    });
  }

  function openChat(target: User) {
    if (!target.id) {
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'Chats',
      params: {
        screen: 'Chat',
        params: {
          userId: target.id,
          name: target.name || 'Пользователь',
        },
      },
    });
  }

  return (
    <Screen scroll={false} padded={false} contentContainerStyle={styles.container}>
      <View style={styles.searchBox}>
        <TextField
          label="Поиск"
          value={query}
          onChangeText={setQuery}
          placeholder="Имя или email"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <FlatList
        data={results}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.listContent,
          results.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          loading ? (
            <LoadingState text="Ищем пользователей" />
          ) : query.trim().length < 2 ? (
            <EmptyState
              title="Введите имя или email"
              text="Начните вводить запрос, чтобы найти пользователя."
            />
          ) : (
            <EmptyState
              title="Никого не нашли"
              text="Попробуйте изменить запрос."
            />
          )
        }
        renderItem={({ item }) => (
          <SearchResultRow
            user={item}
            status={item.id ? statuses[item.id] ?? 'none' : 'none'}
            busy={busyId === item.id}
            onAdd={() => sendRequest(item)}
            onChat={() => openChat(item)}
            onProfile={() => openProfile(item)}
          />
        )}
      />
    </Screen>
  );
}

function SearchResultRow({
  user,
  status,
  busy,
  onAdd,
  onChat,
  onProfile,
}: {
  user: User;
  status: FriendshipStatus;
  busy: boolean;
  onAdd: () => void;
  onChat: () => void;
  onProfile: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onProfile}>
      <View style={styles.avatar}>
        {user.avatar ? (
          <Image
            source={{ uri: assetURL(user.avatar) }}
            style={[
              styles.avatarImage,
              avatarImageStyle({
                size: 44,
                positionX: user.avatarPositionX,
                positionY: user.avatarPositionY,
                scale: user.avatarScale,
              }),
            ]}
          />
        ) : (
          <Text style={styles.avatarText}>
            {(user.name || '?').slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {user.name || 'Пользователь'}
        </Text>
        {user.email ? (
          <Text style={styles.email} numberOfLines={1}>
            {user.email}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {status === 'accepted' ? (
          <AppButton
            title="Написать"
            style={styles.actionButton}
            onPress={onChat}
          />
        ) : status === 'pending' ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>Заявка отправлена</Text>
          </View>
        ) : status === 'blocked' ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>Недоступно</Text>
          </View>
        ) : (
          <AppButton
            title="Добавить"
            variant="secondary"
            style={styles.actionButton}
            loading={busy}
            onPress={onAdd}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 0,
  },
  searchBox: {
    padding: 16,
    paddingBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 124,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.card,
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  avatarImage: {
    width: 44,
    height: 44,
  },
  avatarText: {
    color: colors.accentStrong,
    fontSize: 18,
    fontWeight: '800',
  },
  meta: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  email: {
    color: colors.muted,
    fontSize: 13,
  },
  actions: {
    minWidth: 104,
    alignItems: 'flex-end',
  },
  actionButton: {
    minHeight: 42,
    paddingHorizontal: 12,
  },
  statusPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusPillText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
});
