import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getApiErrorMessage } from '../../api/http';
import { postApi } from '../../api/posts';
import type { Comment, Post, PostUser, User } from '../../api/types';
import { assetURL } from '../../config/env';
import { AppButton } from '../../components/AppButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
} from '../../components/Feedback';
import { useNotifications } from '../../context/NotificationsContext';
import { useThemeColors } from '../../theme/ThemeContext';
import type { ThemeColors } from '../../theme/themes';
import { avatarImageStyle } from '../../utils/avatar';
import { formatDateTime } from '../../utils/format';

const maxPostLength = 500;

type WallFeedProps = {
  currentUser: User | null;
  userId?: number;
  isOwner?: boolean;
  emailVerified: boolean;
  onOpenUser?: (user: PostUser) => void;
};

export function WallFeed({
  currentUser,
  userId,
  isOwner = true,
  emailVerified,
  onOpenUser,
}: WallFeedProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { markMatchingAsRead } = useNotifications();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [openCommentsId, setOpenCommentsId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, Comment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<number, boolean>>(
    {},
  );
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({});
  const [busyPostId, setBusyPostId] = useState<number | null>(null);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextPosts = await postApi.getPosts(userId);
      setPosts(nextPosts);
      if (isOwner) {
        markMatchingAsRead({
          types: ['post_liked', 'comment_created'],
        }).catch(() => undefined);
      }
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }, [isOwner, markMatchingAsRead, userId]);

  useEffect(() => {
    loadPosts().catch(() => undefined);
  }, [loadPosts]);

  async function handleManualRefresh() {
    setManualRefreshing(true);
    try {
      await loadPosts();
    } finally {
      setManualRefreshing(false);
    }
  }

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

  if (loading && !hasLoaded) {
    return <LoadingState text="Загружаем стену" />;
  }

  return (
    <View style={styles.wrapper}>
      <ErrorBanner message={error} />

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

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Стена</Text>
        <AppButton
          title="Обновить"
          variant="ghost"
          loading={manualRefreshing}
          onPress={handleManualRefresh}
        />
      </View>

      {posts.length === 0 ? (
        <EmptyState
          title="Пока нет постов"
          text={
            isOwner
              ? 'Опубликуйте первую запись на своей стене.'
              : 'У пользователя пока нет записей.'
          }
        />
      ) : (
        posts.map(post => (
          <View key={post.id} style={styles.postCard}>
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
                  <Pressable
                    accessibilityRole="button"
                    style={styles.iconButton}
                    disabled={busyPostId === post.id}
                    onPress={() => startEditing(post)}
                  >
                    <Text style={styles.iconText}>Изм</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.iconButton, styles.dangerIconButton]}
                    disabled={busyPostId === post.id}
                    onPress={() => requestDeletePost(post)}
                  >
                    <Text style={[styles.iconText, styles.dangerText]}>
                      Удал
                    </Text>
                  </Pressable>
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
                <Text
                  style={[
                    styles.reactionText,
                    post.is_liked && styles.reactionTextActive,
                  ]}
                >
                  {post.is_liked ? 'Нравится' : 'Лайк'} · {post.likes_count}
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
                <Text
                  style={[
                    styles.reactionText,
                    openCommentsId === post.id && styles.reactionTextActive,
                  ]}
                >
                  Комментарии · {post.comments_count}
                </Text>
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
                            onPress={() =>
                              toggleCommentLike(post.id, comment.id)
                            }
                          >
                            <Text
                              style={[
                                styles.commentLike,
                                comment.is_liked && styles.commentLikeActive,
                              ]}
                            >
                              {comment.is_liked ? 'Нравится' : 'Лайк'} ·{' '}
                              {comment.likes_count}
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
                  <AppButton
                    title="Отправить"
                    loading={busyPostId === post.id}
                    disabled={!commentDraft[post.id]?.trim()}
                    onPress={() => createComment(post.id)}
                    style={styles.commentSend}
                  />
                </View>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
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
      {user?.avatar ? (
        <Image
          source={{ uri: assetURL(user.avatar) }}
          style={avatarImageStyle({
            size,
            positionX: user.avatar_position_x,
            positionY: user.avatar_position_y,
            scale: user.avatar_scale,
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
      gap: 14,
    },
    composer: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.card,
      padding: 14,
      gap: 10,
    },
    composerInput: {
      minHeight: 92,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      lineHeight: 21,
      textAlignVertical: 'top',
    },
    composerFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    counter: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    submitButton: {
      minHeight: 42,
      paddingHorizontal: 12,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
    },
    postCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.card,
      padding: 14,
      gap: 12,
      shadowColor: colors.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 1,
    },
    postHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    author: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    authorMeta: {
      flex: 1,
      gap: 2,
    },
    authorName: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    postDate: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 16,
    },
    postActions: {
      flexDirection: 'row',
      gap: 6,
    },
    iconButton: {
      minWidth: 42,
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 8,
    },
    dangerIconButton: {
      backgroundColor: colors.dangerSoft,
    },
    iconText: {
      color: colors.accentStrong,
      fontSize: 12,
      fontWeight: '900',
    },
    dangerText: {
      color: colors.danger,
    },
    postContent: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
    },
    editBox: {
      gap: 10,
    },
    editInput: {
      minHeight: 98,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      lineHeight: 21,
      textAlignVertical: 'top',
    },
    editActions: {
      flexDirection: 'row',
      gap: 8,
    },
    editButton: {
      flex: 1,
      minHeight: 42,
    },
    reactions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    reactionButton: {
      minHeight: 36,
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 12,
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
      color: colors.muted,
      fontSize: 13,
      fontWeight: '800',
    },
    reactionTextActive: {
      color: colors.accentStrong,
    },
    comments: {
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    commentRow: {
      flexDirection: 'row',
      gap: 10,
    },
    commentBody: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: colors.cardMuted,
      padding: 10,
      gap: 4,
    },
    commentAuthor: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
    },
    commentText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    commentFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    commentDate: {
      color: colors.muted,
      fontSize: 11,
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
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    commentComposer: {
      gap: 8,
    },
    commentInput: {
      minHeight: 76,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
      lineHeight: 20,
      textAlignVertical: 'top',
    },
    commentSend: {
      alignSelf: 'flex-end',
      minHeight: 40,
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
