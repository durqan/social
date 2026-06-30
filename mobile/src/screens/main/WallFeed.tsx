import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  Heart,
  MessageCircle,
  Pencil,
  Send,
  Share2,
  Trash2,
} from 'lucide-react-native';

import { getApiErrorMessage } from '../../api/http';
import { postApi } from '../../api/posts';
import type { Comment, Post, PostUser, User } from '../../api/types';
import { AppButton } from '../../components/AppButton';
import { IconButton } from '../../components/IconButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { WallSkeleton } from '../../components/Skeleton';
import { useNotifications } from '../../context/NotificationsContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { elevation, radius, spacing, typography } from '../../theme/layout';
import { avatarImageStyle, buildAvatarUrl } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';

const maxPostLength = 500;
const POST_PAGE_SIZE = 20;
type LoadMode = 'initial' | 'refresh' | 'silent' | 'more';

type WallFeedProps = {
  currentUser: User | null;
  userId?: number;
  isOwner?: boolean;
  emailVerified: boolean;
  onOpenUser?: (user: PostUser) => void;
  ListHeaderComponent?: ReactNode;
};

export function WallFeed({
  currentUser,
  userId,
  isOwner = true,
  emailVerified,
  onOpenUser,
  ListHeaderComponent,
}: WallFeedProps) {
  const isFocused = useIsFocused();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { markMatchingAsRead } = useNotifications();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [stale, setStale] = useState(false);
  const hasMoreRef = useRef(false);
  const nextOffsetRef = useRef(0);
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openCommentsId, setOpenCommentsId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, Comment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<
    Record<number, boolean>
  >({});
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({});
  const [busyPostId, setBusyPostId] = useState<number | null>(null);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortCurrentLoad = useCallback(() => {
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
  }, []);

  const loadPosts = useCallback(
    async (mode: LoadMode = 'initial') => {
      if (mode === 'more') {
        if (loadingMore || !hasMoreRef.current) {
          return;
        }
      } else {
        abortCurrentLoad();
      }

      const controller = new AbortController();
      loadAbortRef.current = controller;
      const requestSeq = ++loadSeqRef.current;
      const showInitialLoading = mode === 'initial' && !hasLoadedRef.current;

      if (showInitialLoading) {
        setLoading(true);
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }
      if (mode === 'more') {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const offset = mode === 'more' ? nextOffsetRef.current : 0;
        const page = await postApi.getPostsPage(
          userId,
          {
            limit: POST_PAGE_SIZE,
            offset,
          },
          {
            signal: controller.signal,
          },
        );
        if (loadSeqRef.current !== requestSeq) {
          return;
        }
        setStale(Boolean(page.stale));
        hasMoreRef.current = page.has_more;
        nextOffsetRef.current = page.next_offset ?? offset + page.posts.length;
        setHasMore(page.has_more);
        setPosts(previous => {
          if (mode !== 'more') {
            return page.posts;
          }
          const existingIds = new Set(previous.map(post => post.id));
          const newPosts = page.posts.filter(post => !existingIds.has(post.id));
          return newPosts.length ? [...previous, ...newPosts] : previous;
        });
        if (isOwner) {
          markMatchingAsRead({
            types: ['post_liked', 'comment_created'],
          }).catch(() => undefined);
        }
      } catch (apiError) {
        if ((apiError as Error)?.message === 'request aborted') {
          return;
        }
        setError(getApiErrorMessage(apiError));
      } finally {
        if (loadSeqRef.current === requestSeq) {
          hasLoadedRef.current = true;
          setHasLoaded(true);
          if (showInitialLoading) {
            setLoading(false);
          }
          if (mode === 'refresh') {
            setRefreshing(false);
          }
          if (mode === 'more') {
            setLoadingMore(false);
          }
          if (loadAbortRef.current === controller) {
            loadAbortRef.current = null;
          }
        }
      }
    },
    [abortCurrentLoad, isOwner, loadingMore, markMatchingAsRead, userId],
  );

  useFocusEffect(
    useCallback(() => {
      loadPosts(hasLoadedRef.current ? 'silent' : 'initial').catch(
        () => undefined,
      );
      return () => {
        abortCurrentLoad();
      };
    }, [abortCurrentLoad, loadPosts]),
  );

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    loadPosts('silent').catch(() => undefined);
  });

  async function loadComments(postId: number) {
    setCommentsLoading(previous => ({ ...previous, [postId]: true }));
    setError(null);
    try {
      const nextComments = await postApi.getComments(postId);
      setComments(previous => ({ ...previous, [postId]: nextComments }));
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setCommentsLoading(previous => ({ ...previous, [postId]: false }));
    }
  }

  async function createPost() {
    const content = draft.trim();
    if (!content) {
      return;
    }
    if (!emailVerified) {
      setError('Подтвердите email, чтобы продолжить.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const post = await postApi.createPost(content);
      setPosts(previous => [post, ...previous]);
      setDraft('');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setSubmitting(false);
    }
  }

  async function savePost(postId: number) {
    const content = editDraft.trim();
    if (!content) {
      return;
    }

    setBusyPostId(postId);
    setError(null);
    try {
      const post = await postApi.updatePost(postId, content);
      setPosts(previous =>
        previous.map(item => (item.id === postId ? post : item)),
      );
      setEditingPostId(null);
      setEditDraft('');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyPostId(null);
    }
  }

  function requestDeletePost(post: Post) {
    Alert.alert('Удалить пост?', 'Пост будет удален без возможности отмены.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          deletePost(post.id).catch(() => undefined);
        },
      },
    ]);
  }

  async function deletePost(postId: number) {
    setBusyPostId(postId);
    setError(null);
    try {
      await postApi.deletePost(postId);
      setPosts(previous => previous.filter(post => post.id !== postId));
      setComments(previous => {
        const next = { ...previous };
        delete next[postId];
        return next;
      });
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyPostId(null);
    }
  }

  async function togglePostLike(postId: number) {
    const previousPosts = posts;
    setPosts(current =>
      current.map(post =>
        post.id === postId
          ? {
              ...post,
              is_liked: !post.is_liked,
              likes_count: Math.max(
                0,
                post.likes_count + (post.is_liked ? -1 : 1),
              ),
            }
          : post,
      ),
    );
    try {
      const response = await postApi.toggleLike(postId);
      setPosts(current =>
        current.map(post =>
          post.id === postId
            ? {
                ...post,
                is_liked: response.is_liked,
                likes_count: Number(response.likes_count) || 0,
              }
            : post,
        ),
      );
    } catch (apiError) {
      setPosts(previousPosts);
      setError(getApiErrorMessage(apiError));
    }
  }

  async function sharePost(post: Post) {
    const title = post.user?.name ? `Пост ${post.user.name}` : 'Пост';
    const message = `${post.content}\n\nsocial://users/${post.user?.id ?? userId}`;
    try {
      await Share.share({ title, message });
    } catch {
      // Native share can be cancelled by the user.
    }
  }

  async function toggleCommentLike(postId: number, commentId: number) {
    setBusyCommentId(commentId);
    setError(null);
    try {
      const response = await postApi.toggleCommentLike(postId, commentId);
      setComments(previous => ({
        ...previous,
        [postId]:
          previous[postId]?.map(comment =>
            comment.id === commentId
              ? {
                  ...comment,
                  is_liked: response.is_liked,
                  likes_count: Number(response.likes_count) || 0,
                }
              : comment,
          ) || [],
      }));
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyCommentId(null);
    }
  }

  async function toggleComments(postId: number) {
    if (openCommentsId === postId) {
      setOpenCommentsId(null);
      return;
    }

    setOpenCommentsId(postId);
    if (!comments[postId]) {
      await loadComments(postId);
    }
  }

  async function createComment(postId: number) {
    const content = commentDraft[postId]?.trim();
    if (!content) {
      return;
    }
    if (!emailVerified) {
      setError('Подтвердите email, чтобы продолжить.');
      return;
    }

    setBusyPostId(postId);
    setError(null);
    try {
      const comment = await postApi.createComment(postId, content);
      setComments(previous => ({
        ...previous,
        [postId]: [...(previous[postId] || []), comment],
      }));
      setPosts(previous =>
        previous.map(post =>
          post.id === postId
            ? { ...post, comments_count: post.comments_count + 1 }
            : post,
        ),
      );
      setCommentDraft(previous => ({ ...previous, [postId]: '' }));
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setBusyPostId(null);
    }
  }

  function startEditing(post: Post) {
    setEditingPostId(post.id);
    setEditDraft(post.content);
  }

  const renderPost = ({ item: post }: { item: Post }) => (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <Pressable
          style={styles.author}
          onPress={() => onOpenUser?.(post.user)}
        >
          <PostAvatar user={post.user} colors={colors} />
          <View style={styles.authorMeta}>
            <Text style={styles.authorName} numberOfLines={1}>
              {post.user?.name || 'Пользователь'}
            </Text>
            <Text style={styles.postDate}>
              {formatDateTime(post.created_at)}
            </Text>
          </View>
        </Pressable>

        {currentUser?.id === post.user?.id ? (
          <View style={styles.postActions}>
            <IconButton
              icon={Pencil}
              label="Редактировать пост"
              size="sm"
              variant="ghost"
              disabled={busyPostId === post.id}
              onPress={() => startEditing(post)}
            />
            <IconButton
              icon={Trash2}
              label="Удалить пост"
              size="sm"
              variant="danger"
              disabled={busyPostId === post.id}
              onPress={() => requestDeletePost(post)}
            />
          </View>
        ) : null}
      </View>

      {editingPostId === post.id ? (
        <View style={styles.editBox}>
          <TextInput
            value={editDraft}
            onChangeText={setEditDraft}
            placeholder="Текст поста"
            placeholderTextColor={colors.soft}
            multiline
            maxLength={maxPostLength}
            style={styles.editInput}
          />
          <View style={styles.editActions}>
            <AppButton
              title="Сохранить"
              loading={busyPostId === post.id}
              disabled={!editDraft.trim()}
              onPress={() => savePost(post.id)}
              style={styles.editButton}
            />
            <AppButton
              title="Отмена"
              variant="secondary"
              onPress={() => {
                setEditingPostId(null);
                setEditDraft('');
              }}
              style={styles.editButton}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.postContent}>{post.content}</Text>
      )}

      <View style={styles.reactions}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.reactionButton,
            post.is_liked && styles.reactionButtonActive,
            pressed && styles.reactionButtonPressed,
          ]}
          onPress={() => togglePostLike(post.id)}
        >
          <Heart
            color={post.is_liked ? colors.accentStrong : colors.muted}
            fill={post.is_liked ? colors.accentStrong : 'transparent'}
            size={16}
            strokeWidth={2.2}
          />
          <Text
            style={[
              styles.reactionText,
              post.is_liked && styles.reactionTextActive,
            ]}
          >
            {post.likes_count}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.reactionButton,
            openCommentsId === post.id && styles.reactionButtonActive,
            pressed && styles.reactionButtonPressed,
          ]}
          onPress={() => {
            toggleComments(post.id).catch(() => undefined);
          }}
        >
          <MessageCircle
            color={
              openCommentsId === post.id ? colors.accentStrong : colors.muted
            }
            size={16}
            strokeWidth={2.2}
          />
          <Text
            style={[
              styles.reactionText,
              openCommentsId === post.id && styles.reactionTextActive,
            ]}
          >
            {post.comments_count}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.reactionButton,
            pressed && styles.reactionButtonPressed,
          ]}
          onPress={() => {
            sharePost(post).catch(() => undefined);
          }}
        >
          <Share2 color={colors.muted} size={16} strokeWidth={2.2} />
          <Text style={styles.reactionText}>Поделиться</Text>
        </Pressable>
      </View>

      {openCommentsId === post.id ? (
        <View style={styles.comments}>
          {commentsLoading[post.id] ? (
            <LoadingState text="Загружаем комментарии" />
          ) : comments[post.id]?.length ? (
            comments[post.id].map(comment => (
              <View key={comment.id} style={styles.commentRow}>
                <PostAvatar user={comment.user} colors={colors} small />
                <View style={styles.commentBody}>
                  <Text style={styles.commentAuthor}>
                    {comment.user?.name || 'Пользователь'}
                  </Text>
                  <Text style={styles.commentText}>{comment.content}</Text>
                  <View style={styles.commentFooter}>
                    <Text style={styles.commentDate}>
                      {formatDateTime(comment.created_at)}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busyCommentId === comment.id}
                      onPress={() => toggleCommentLike(post.id, comment.id)}
                    >
                      <Text
                        style={[
                          styles.commentLike,
                          comment.is_liked && styles.commentLikeActive,
                        ]}
                      >
                        {comment.is_liked ? '♥' : '♡'} {comment.likes_count}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noComments}>Комментариев пока нет.</Text>
          )}

          <View style={styles.commentComposer}>
            <TextInput
              value={commentDraft[post.id] || ''}
              onChangeText={content =>
                setCommentDraft(previous => ({
                  ...previous,
                  [post.id]: content,
                }))
              }
              placeholder="Написать комментарий..."
              placeholderTextColor={colors.soft}
              multiline
              maxLength={maxPostLength}
              style={styles.commentInput}
            />
            <IconButton
              icon={Send}
              label="Отправить комментарий"
              variant="primary"
              loading={busyPostId === post.id}
              disabled={!commentDraft[post.id]?.trim()}
              onPress={() => createComment(post.id)}
              style={styles.commentSend}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  const header = (
    <View style={styles.headerContent}>
      {ListHeaderComponent}
      <ErrorBanner message={error} />
      {stale ? (
        <View style={styles.staleNotice}>
          <Text style={styles.staleNoticeText}>
            Показаны сохраненные данные. Обновим, когда сеть станет стабильной.
          </Text>
        </View>
      ) : null}

      {isOwner ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Что у вас нового?"
            placeholderTextColor={colors.soft}
            multiline
            maxLength={maxPostLength}
            style={styles.composerInput}
          />
          <View style={styles.composerFooter}>
            <Text style={styles.counter}>
              {draft.length}/{maxPostLength}
            </Text>
            <AppButton
              title="Опубликовать"
              loading={submitting}
              disabled={!draft.trim()}
              onPress={createPost}
              style={styles.submitButton}
            />
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Стена</Text>
      {loading && !hasLoaded ? <WallSkeleton /> : null}
    </View>
  );

  return (
    <FlatList
      data={posts}
      keyExtractor={item => String(item.id)}
      renderItem={renderPost}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading && !hasLoaded ? null : (
          <EmptyState
            icon={MessageCircle}
            title="Пока нет постов"
            text={
              isOwner
                ? 'Опубликуйте первую запись на своей стене.'
                : 'У пользователя пока нет записей.'
            }
          />
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.loadingMore}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null
      }
      contentContainerStyle={[
        styles.wrapper,
        posts.length === 0 && styles.emptyWrapper,
      ]}
      refreshing={refreshing}
      onRefresh={() => loadPosts('refresh')}
      onEndReached={() => {
        if (hasMore && !loadingMore) {
          loadPosts('more').catch(() => undefined);
        }
      }}
      onEndReachedThreshold={0.4}
      initialNumToRender={6}
      windowSize={7}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={60}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
    />
  );
}

function PostAvatar({
  user,
  colors,
  small = false,
}: {
  user?: PostUser;
  colors: ThemeColors;
  small?: boolean;
}) {
  const styles = createStyles(colors);
  const size = small ? 34 : 42;
  const avatarUrl = buildAvatarUrl(user);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={avatarImageStyle({
            size,
            positionX: user?.avatar_position_x,
            positionY: user?.avatar_position_y,
            scale: user?.avatar_scale,
          })}
        />
      ) : (
        <Text style={[styles.avatarText, small && styles.avatarTextSmall]}>
          {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: 124,
      gap: spacing.md,
    },
    emptyWrapper: {
      flexGrow: 1,
    },
    headerContent: {
      gap: spacing.md,
    },
    staleNotice: {
      borderWidth: 1,
      borderColor: colors.accentBorder,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      padding: spacing.md,
    },
    staleNoticeText: {
      ...typography.caption,
      color: colors.accentStrong,
      fontWeight: '700',
    },
    loadingMore: {
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composer: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: colors.shadow,
      shadowOpacity: colors.isDark ? 0 : 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 9 },
      elevation: colors.isDark ? 0 : 1,
    },
    composerInput: {
      minHeight: 92,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...typography.body,
      textAlignVertical: 'top',
    },
    composerFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    counter: {
      ...typography.tiny,
      color: colors.muted,
      fontWeight: '700',
    },
    submitButton: {
      minHeight: 42,
      paddingHorizontal: 12,
    },
    sectionTitle: {
      ...typography.h2,
      color: colors.text,
    },
    postCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.md,
      shadowColor: colors.shadow,
      ...(colors.isDark ? elevation.none : elevation.card),
    },
    postHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    author: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    authorMeta: {
      flex: 1,
      gap: 2,
    },
    authorName: {
      ...typography.body,
      color: colors.text,
      fontWeight: '800',
    },
    postDate: {
      ...typography.tiny,
      color: colors.muted,
    },
    postActions: {
      flexDirection: 'row',
      gap: 6,
    },
    postContent: {
      ...typography.body,
      color: colors.text,
    },
    editBox: {
      gap: 10,
    },
    editInput: {
      minHeight: 98,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...typography.body,
      textAlignVertical: 'top',
    },
    editActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    editButton: {
      flex: 1,
      minHeight: 42,
    },
    reactions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
    reactionButton: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.cardMuted,
      paddingHorizontal: spacing.md,
    },
    reactionButtonActive: {
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    reactionButtonPressed: {
      backgroundColor: colors.pressed,
    },
    reactionText: {
      ...typography.caption,
      color: colors.muted,
      fontWeight: '800',
    },
    reactionTextActive: {
      color: colors.accentStrong,
    },
    comments: {
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
    },
    commentRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    commentBody: {
      flex: 1,
      borderRadius: radius.lg,
      backgroundColor: colors.cardMuted,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    commentAuthor: {
      ...typography.caption,
      color: colors.text,
      fontWeight: '800',
    },
    commentText: {
      ...typography.caption,
      color: colors.text,
    },
    commentFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    commentDate: {
      ...typography.tiny,
      color: colors.muted,
    },
    commentLike: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '800',
    },
    commentLikeActive: {
      color: colors.accentStrong,
    },
    noComments: {
      ...typography.caption,
      color: colors.muted,
      textAlign: 'center',
    },
    commentComposer: {
      gap: spacing.sm,
    },
    commentInput: {
      minHeight: 76,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...typography.caption,
      textAlignVertical: 'top',
    },
    commentSend: {
      alignSelf: 'flex-end',
      width: 42,
      height: 42,
    },
    avatar: {
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.accentSoft,
    },
    avatarText: {
      color: colors.accentStrong,
      fontSize: 16,
      fontWeight: '900',
    },
    avatarTextSmall: {
      fontSize: 13,
    },
  });
