import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { authApi, postApi } from '../api/services';
import { Button, Card, EmptyState, Field } from '../components/ui';
import type { Comment, Post } from '../types';
import { alertError } from '../utils/errors';

export function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [content, setContent] = useState('');
  const [activePostId, setActivePostId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, Comment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await postApi.list();
    setPosts(data);
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

  const createPost = async () => {
    if (!content.trim()) return;
    try {
      await postApi.create(content.trim());
      setContent('');
      await load();
    } catch (error) {
      alertError(error, 'Не удалось создать пост');
    }
  };

  const like = async (post: Post) => {
    try {
      const result = await postApi.like(post.id);
      setPosts(current =>
        current.map(item => (item.id === post.id ? { ...item, is_liked: result.is_liked, likes_count: result.likes_count } : item)),
      );
    } catch (error) {
      alertError(error, 'Не удалось поставить лайк');
    }
  };

  const toggleComments = async (post: Post) => {
    if (activePostId === post.id) {
      setActivePostId(null);
      return;
    }
    setActivePostId(post.id);
    if (!comments[post.id]) {
      setComments(current => ({ ...current, [post.id]: [] }));
      const data = await postApi.comments(post.id);
      setComments(current => ({ ...current, [post.id]: data }));
    }
  };

  const createComment = async (post: Post) => {
    const text = commentDrafts[post.id]?.trim();
    if (!text) return;
    try {
      await postApi.comment(post.id, text);
      setCommentDrafts(current => ({ ...current, [post.id]: '' }));
      const data = await postApi.comments(post.id);
      setComments(current => ({ ...current, [post.id]: data }));
      setPosts(current =>
        current.map(item => (item.id === post.id ? { ...item, comments_count: (item.comments_count || 0) + 1 } : item)),
      );
    } catch (error) {
      alertError(error, 'Не удалось добавить комментарий');
    }
  };

  const verifyEmail = async () => {
    try {
      const result = await authApi.sendVerificationEmail();
      Alert.alert('Письмо отправлено', result.message);
    } catch (error) {
      alertError(error, 'Не удалось отправить письмо');
    }
  };

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={
        <Card>
          <Text style={styles.title}>Лента</Text>
          <Field value={content} onChangeText={setContent} placeholder="Что нового?" multiline />
          <View style={styles.action}>
            <Button title="Опубликовать" onPress={createPost} />
          </View>
          <View style={styles.secondaryAction}>
            <Button title="Отправить письмо подтверждения" variant="secondary" onPress={verifyEmail} />
          </View>
        </Card>
      }
      data={posts}
      keyExtractor={item => String(item.id)}
      ListEmptyComponent={<EmptyState text="Пока нет постов" />}
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.author}>{item.user?.name || 'Пользователь'}</Text>
          <Text style={styles.postText}>{item.content}</Text>
          <Pressable onPress={() => like(item)} style={styles.like}>
            <Text style={styles.likeText}>{item.is_liked ? '♥' : '♡'} {item.likes_count || 0}</Text>
            <Pressable onPress={() => toggleComments(item)}>
              <Text style={styles.meta}>Комментарии: {item.comments_count || 0}</Text>
            </Pressable>
          </Pressable>
          {activePostId === item.id && (
            <View style={styles.comments}>
              {(comments[item.id] || []).map(comment => (
                <View key={comment.id} style={styles.comment}>
                  <Text style={styles.commentAuthor}>{comment.user?.name || 'Пользователь'}</Text>
                  <Text style={styles.commentText}>{comment.content}</Text>
                </View>
              ))}
              <Field
                value={commentDrafts[item.id] || ''}
                onChangeText={value => setCommentDrafts(current => ({ ...current, [item.id]: value }))}
                placeholder="Комментарий"
              />
              <Button title="Отправить комментарий" variant="secondary" onPress={() => createComment(item)} />
            </View>
          )}
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
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  action: {
    marginTop: 10,
  },
  secondaryAction: {
    marginTop: 8,
  },
  author: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  postText: {
    color: '#1f2937',
    fontSize: 15,
    lineHeight: 22,
  },
  like: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  likeText: {
    color: '#0284c7',
    fontSize: 15,
    fontWeight: '800',
  },
  meta: {
    color: '#6b7280',
    fontSize: 13,
  },
  comments: {
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 12,
  },
  comment: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 10,
  },
  commentAuthor: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  commentText: {
    color: '#374151',
    fontSize: 14,
  },
});
