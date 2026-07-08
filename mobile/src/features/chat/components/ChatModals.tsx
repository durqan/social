import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import {
  Copy,
  Download,
  Forward,
  Link,
  Pencil,
  Pin,
  Reply,
  Trash2,
} from 'lucide-react-native';

import type { Message, User } from '../../../api/types';
import type { MessageDeleteMode } from '../../../api/messages';
import type { ThemeColors } from '../../../theme/themes';
import { isAttachmentDownloadable } from '../lib/attachmentDownload';
import { createChatThemeStyles, styles } from '../lib/chatStyles';
import { firstUrl, isPersistedMessage, messagePreviewText } from '../lib/chatUtils';

export function MessageActionSheet({
  message,
  isOwn,
  onClose,
  onCopyText,
  onCopyLink,
  onEdit,
  onDelete,
  onReply,
  onForward,
  onPin,
  onDownloadAttachments,
  actionPending,
  themeColors,
}: {
  message: Message | null;
  isOwn: boolean;
  onClose: () => void;
  onCopyText: (message: Message) => void;
  onCopyLink: (url: string) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message, mode: MessageDeleteMode) => void;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onDownloadAttachments: (message: Message) => void;
  actionPending: boolean;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const trimmedText = message?.content.trim() ?? '';
  const messageUrl = message ? firstUrl(message.content) : '';
  const messageIsReal = Boolean(
    message && isPersistedMessage(message),
  );
  const hasDownloadableAttachments = Boolean(
    message?.attachments?.some(isAttachmentDownloadable),
  );

  return (
    <Modal
      visible={Boolean(message)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.sheetBackdrop, themed.sheetBackdrop]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.sheet, themed.sheet]}
          onPress={event => event.stopPropagation()}
        >
          <View style={[styles.sheetHandle, themed.sheetHandle]} />
          <Text style={[styles.sheetTitle, themed.mutedText]}>Сообщение</Text>

          {message ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onReply(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Reply color={themeColors.muted} size={17} strokeWidth={2.2} />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Ответить
              </Text>
            </Pressable>
          ) : null}

          {message && hasDownloadableAttachments ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onDownloadAttachments(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Download
                  color={themeColors.muted}
                  size={17}
                  strokeWidth={2.2}
                />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Скачать вложения
              </Text>
            </Pressable>
          ) : null}

          {message ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onForward(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Forward
                  color={themeColors.muted}
                  size={17}
                  strokeWidth={2.2}
                />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Переслать
              </Text>
            </Pressable>
          ) : null}

          {message ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onPin(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Pin color={themeColors.muted} size={17} strokeWidth={2.2} />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Закрепить
              </Text>
            </Pressable>
          ) : null}

          {message && isOwn && trimmedText ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onEdit(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Pencil color={themeColors.muted} size={17} strokeWidth={2.2} />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Редактировать
              </Text>
            </Pressable>
          ) : null}

          {message ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={[styles.sheetAction, styles.sheetDangerAction]}
              onPress={() => onDelete(message, 'for_me')}
            >
              <View
                style={[
                  styles.sheetActionIcon,
                  themed.sheetActionIcon,
                  styles.sheetDangerIcon,
                  themed.dangerSoft,
                ]}
              >
                <Trash2
                  color={themeColors.danger}
                  size={17}
                  strokeWidth={2.2}
                />
              </View>
              <Text
                style={[
                  styles.sheetActionText,
                  styles.sheetDangerText,
                  themed.dangerText,
                ]}
              >
                Удалить у себя
              </Text>
            </Pressable>
          ) : null}

          {message && isOwn && messageIsReal ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={[styles.sheetAction, styles.sheetDangerAction]}
              onPress={() => onDelete(message, 'for_everyone')}
            >
              <View
                style={[
                  styles.sheetActionIcon,
                  themed.sheetActionIcon,
                  styles.sheetDangerIcon,
                  themed.dangerSoft,
                ]}
              >
                <Trash2
                  color={themeColors.danger}
                  size={17}
                  strokeWidth={2.2}
                />
              </View>
              <Text
                style={[
                  styles.sheetActionText,
                  styles.sheetDangerText,
                  themed.dangerText,
                ]}
              >
                Удалить у всех
              </Text>
            </Pressable>
          ) : null}

          {trimmedText ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => message && onCopyText(message)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Copy color={themeColors.muted} size={17} strokeWidth={2.2} />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Скопировать текст
              </Text>
            </Pressable>
          ) : null}

          {messageUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: actionPending }}
              disabled={actionPending}
              style={styles.sheetAction}
              onPress={() => onCopyLink(messageUrl)}
            >
              <View style={[styles.sheetActionIcon, themed.sheetActionIcon]}>
                <Link color={themeColors.muted} size={17} strokeWidth={2.2} />
              </View>
              <Text style={[styles.sheetActionText, themed.text]}>
                Скопировать ссылку
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ForwardMessageModal({
  message,
  friends,
  selectedIds,
  loading,
  error,
  onClose,
  onToggleRecipient,
  onSubmit,
  themeColors,
}: {
  message: Message | null;
  friends: User[];
  selectedIds: Set<number>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onToggleRecipient: (userId: number) => void;
  onSubmit: () => void;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  return (
    <Modal
      visible={Boolean(message)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.sheetBackdrop, themed.sheetBackdrop]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.sheet, themed.sheet]}
          onPress={event => event.stopPropagation()}
        >
          <View style={[styles.sheetHandle, themed.sheetHandle]} />
          <Text style={[styles.sheetTitle, themed.mutedText]}>
            Переслать сообщение
          </Text>
          {message ? (
            <View style={[styles.forwardPreview, themed.surfaceMuted]}>
              <Text
                style={[styles.forwardPreviewText, themed.text]}
                numberOfLines={2}
              >
                {messagePreviewText(message)}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={[styles.forwardError, themed.dangerText]}>
              {error}
            </Text>
          ) : null}
          {loading && friends.length === 0 ? (
            <View style={styles.forwardLoading}>
              <ActivityIndicator color={themeColors.accent} />
              <Text style={[styles.sendStatusText, themed.mutedText]}>
                Загружаем друзей
              </Text>
            </View>
          ) : friends.length === 0 ? (
            <Text style={[styles.forwardEmpty, themed.mutedText]}>
              Нет друзей для пересылки
            </Text>
          ) : (
            <View style={styles.forwardList}>
              {friends.map(friend => {
                const friendId = friend.id;
                if (!friendId) {
                  return null;
                }
                const selected = selectedIds.has(friendId);
                return (
                  <Pressable
                    key={friendId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.forwardRecipient,
                      themed.forwardRecipient,
                      selected && styles.forwardRecipientSelected,
                      selected && themed.forwardRecipientSelected,
                    ]}
                    onPress={() => onToggleRecipient(friendId)}
                  >
                    <Text
                      style={[styles.forwardRecipientName, themed.text]}
                      numberOfLines={1}
                    >
                      {friend.name || 'Пользователь'}
                    </Text>
                    <Text
                      style={[
                        styles.forwardCheck,
                        themed.forwardCheck,
                        selected && styles.forwardCheckSelected,
                        selected && themed.forwardCheckSelected,
                      ]}
                    >
                      {selected ? '✓' : '+'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.forwardActions}>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.forwardButton,
                styles.forwardCancelButton,
                themed.surfaceMuted,
              ]}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={[styles.forwardCancelText, themed.text]}>
                Отмена
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.forwardButton,
                styles.forwardSubmitButton,
                themed.accentBg,
              ]}
              onPress={onSubmit}
              disabled={loading || selectedIds.size === 0}
            >
              <Text style={styles.forwardSubmitText}>
                {loading ? 'Отправляем…' : 'Переслать'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
