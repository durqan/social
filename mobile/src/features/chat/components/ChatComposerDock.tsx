import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { LiquidGlassView } from '@sbaiahmed1/react-native-blur';
import {
  File as FileIcon,
  FileAudio,
  FileText,
  Pause,
  Paperclip,
  Pencil,
  Play,
  Send,
  Smile,
  Trash2,
  Video as VideoIcon,
} from 'lucide-react-native';
import Video from 'react-native-video';
import type { Message } from '../../../api/types';

import type {
  LocalVideoNoteMessage,
  LocalVoiceMessage,
} from '../../../api/messages';
import { IconButton } from '../../../components/IconButton';
import { formatDuration } from '../../../utils/format';
import type { ThemeColors } from '../../../theme/themes';
import {
  CHAT_INPUT_NATIVE_ID,
  COMPOSER_INPUT_MAX_HEIGHT,
  LONG_PRESS_DELAY_MS,
  type SendingState,
} from '../lib/chatScreenConfig';
import { styles, type ChatThemeStyles } from '../lib/chatStyles';
import { messageAuthorName, messagePreviewText } from '../lib/chatUtils';
import {
  pendingAttachmentSubtitle,
  type PendingChatAttachment,
} from '../lib/pendingAttachments';
import { VideoNoteAttachment } from './MessageBubble';

type ComposerIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

type UploadProgress = {
  current: number;
  total: number;
} | null;

type ChatComposerDockProps = {
  composerRef: React.RefObject<View | null>;
  inputRef: React.RefObject<TextInput | null>;
  previewProgressBarRef: React.RefObject<View | null>;
  themed: ChatThemeStyles;
  themeColors: ThemeColors;
  pendingAttachments: PendingChatAttachment[];
  sending: SendingState;
  uploadProgress: UploadProgress;
  editingMessage: Message | null;
  replyToMessage: Message | null;
  recording: boolean;
  recordingSeconds: number;
  recordingBusy: boolean;
  pendingVideoNote: LocalVideoNoteMessage | null;
  pendingVoice: LocalVoiceMessage | null;
  previewPlaying: boolean;
  previewPosition: number;
  otherTyping: boolean;
  otherName: string;
  input: string;
  inputHeight: number;
  messageActionPending: boolean;
  trimmedInput: string;
  showComposerSendButton: boolean;
  composerMediaIcon: ComposerIcon;
  composerMediaLabel: string;
  composerMediaDisabled: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onRemovePendingAttachment: (id: string) => void;
  onCancelEditing: () => void;
  onClearReply: () => void;
  onStopVoiceRecording: (commitToPreview: boolean) => Promise<void> | void;
  onDeletePendingVideoNote: () => void;
  onSendPendingVideoNote: () => Promise<void> | void;
  onTogglePreviewPlayback: () => Promise<void> | void;
  onPreviewProgressPress: (
    event: GestureResponderEvent,
  ) => Promise<void> | void;
  onDeletePendingVoice: () => Promise<void> | void;
  onSendPendingVoice: () => Promise<void> | void;
  onOpenAttachments: () => Promise<void> | void;
  onShowStickerNotice: () => void;
  onInputChange: (value: string) => void;
  onInputFocus: () => void;
  onInputContentSizeChange: (height: number) => void;
  onSendMessage: () => Promise<void> | void;
  onToggleComposerMediaMode: () => void;
  onStartComposerMediaRecording: () => Promise<void> | void;
  onStopComposerMediaRecording: () => void;
};

function ignoreAsync(result: Promise<void> | void) {
  Promise.resolve(result).catch(() => undefined);
}

function sendingStatusText(
  sending: NonNullable<SendingState>,
  uploadProgress: UploadProgress,
) {
  switch (sending) {
    case 'uploadingVoice':
      return 'Загружаем голосовое сообщение';
    case 'preparingVideo':
      return 'Подготовка видео...';
    case 'compressingVideo':
      return 'Сжатие видео...';
    case 'uploadingVideo':
      return 'Загрузка видео...';
    case 'uploadingVideoNote':
      return 'Загружаем видео-сообщение';
    case 'uploading':
      return uploadProgress
        ? `Загружаем вложения: ${uploadProgress.current} из ${uploadProgress.total}`
        : 'Загружаем вложение';
    case 'sending':
      return 'Отправляем сообщение';
  }
}

export function ChatComposerDock({
  composerRef,
  inputRef,
  previewProgressBarRef,
  themed,
  themeColors,
  pendingAttachments,
  sending,
  uploadProgress,
  editingMessage,
  replyToMessage,
  recording,
  recordingSeconds,
  recordingBusy,
  pendingVideoNote,
  pendingVoice,
  previewPlaying,
  previewPosition,
  otherTyping,
  otherName,
  input,
  inputHeight,
  messageActionPending,
  trimmedInput,
  showComposerSendButton,
  composerMediaIcon,
  composerMediaLabel,
  composerMediaDisabled,
  onLayout,
  onRemovePendingAttachment,
  onCancelEditing,
  onClearReply,
  onStopVoiceRecording,
  onDeletePendingVideoNote,
  onSendPendingVideoNote,
  onTogglePreviewPlayback,
  onPreviewProgressPress,
  onDeletePendingVoice,
  onSendPendingVoice,
  onOpenAttachments,
  onShowStickerNotice,
  onInputChange,
  onInputFocus,
  onInputContentSizeChange,
  onSendMessage,
  onToggleComposerMediaMode,
  onStartComposerMediaRecording,
  onStopComposerMediaRecording,
}: ChatComposerDockProps) {
  return (
    <View
      ref={composerRef}
      style={[styles.composerDock, themed.composerDock]}
      onLayout={onLayout}
    >
      {pendingAttachments.length > 0 ? (
        <View style={styles.previewStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewStripContent}
          >
            {pendingAttachments.map(attachment => {
              const AttachmentIcon =
                attachment.fileType === 'audio'
                  ? FileAudio
                  : attachment.fileType === 'file'
                    ? FileText
                    : FileIcon;

              return (
                <View
                  key={attachment.id}
                  style={[
                    styles.previewItem,
                    (attachment.fileType === 'audio' ||
                      attachment.fileType === 'file') &&
                      styles.previewFileItem,
                  ]}
                >
                  {attachment.fileType === 'image' ? (
                    <Image
                      source={{ uri: attachment.uri }}
                      style={styles.previewImage}
                    />
                  ) : attachment.fileType === 'video' ? (
                    <View style={styles.previewVideoTile}>
                      <Video
                        source={{ uri: attachment.uri }}
                        style={styles.previewVideoThumbnail}
                        paused
                        muted
                        resizeMode="cover"
                      />
                      <View style={styles.previewVideoBadge}>
                        <VideoIcon
                          color={themeColors.white}
                          size={18}
                          strokeWidth={2.5}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.previewFileTile, themed.cardMuted]}>
                      <View style={[styles.previewFileIcon, themed.accentBg]}>
                        <AttachmentIcon
                          color={themeColors.white}
                          size={20}
                          strokeWidth={2.4}
                        />
                      </View>
                      <View style={styles.previewFileMeta}>
                        <Text
                          style={[styles.previewFileName, themed.text]}
                          numberOfLines={1}
                        >
                          {attachment.fileName}
                        </Text>
                        <Text
                          style={[styles.previewFileDetail, themed.mutedText]}
                          numberOfLines={1}
                        >
                          {pendingAttachmentSubtitle(attachment)}
                        </Text>
                      </View>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Убрать вложение"
                    style={styles.previewRemove}
                    onPress={() => onRemovePendingAttachment(attachment.id)}
                  >
                    <Text style={styles.previewRemoveText}>×</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {sending ? (
        <View style={[styles.sendStatus, themed.surfaceBar]}>
          <ActivityIndicator color={themeColors.accent} />
          <Text style={[styles.sendStatusText, themed.mutedText]}>
            {sendingStatusText(sending, uploadProgress)}
          </Text>
        </View>
      ) : null}

      {editingMessage ? (
        <View style={[styles.editingBar, themed.surfaceBar]}>
          <View style={[styles.editingInfo, themed.accentLeftBorder]}>
            <Text style={[styles.editingTitle, themed.accentText]}>
              Редактирование
            </Text>
            <Text
              style={[styles.editingText, themed.mutedText]}
              numberOfLines={1}
            >
              {editingMessage.content}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={[styles.editingCancel, themed.surfaceMuted]}
            onPress={onCancelEditing}
          >
            <Text style={[styles.editingCancelText, themed.mutedText]}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {replyToMessage && !editingMessage ? (
        <View style={[styles.replyBar, themed.surfaceBar]}>
          <View style={[styles.replyInfo, themed.accentLeftBorder]}>
            <Text style={[styles.replyTitle, themed.accentText]}>
              Ответ {messageAuthorName(replyToMessage)}
            </Text>
            <Text
              style={[styles.replyText, themed.mutedText]}
              numberOfLines={1}
            >
              {messagePreviewText(replyToMessage)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={[styles.editingCancel, themed.surfaceMuted]}
            onPress={onClearReply}
          >
            <Text style={[styles.editingCancelText, themed.mutedText]}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {recording ? (
        <View style={[styles.recordingBar, themed.surfaceMutedBar]}>
          <View style={[styles.recordingDot, themed.accentBg]} />
          <Text style={[styles.recordingTime, themed.accentText]}>
            {formatDuration(recordingSeconds)}
          </Text>
          <Text style={styles.recordingText} numberOfLines={1}>
            Идет запись
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.recordingCancel}
            disabled={recordingBusy}
            onPress={() => ignoreAsync(onStopVoiceRecording(false))}
          >
            <Text style={styles.recordingCancelText}>Отмена</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.recordingSend}
            disabled={recordingBusy}
            onPress={() => ignoreAsync(onStopVoiceRecording(true))}
          >
            <Text style={styles.recordingSendText}>Готово</Text>
          </Pressable>
        </View>
      ) : null}

      {pendingVideoNote ? (
        <View style={[styles.previewVideoNoteCard, themed.cardMuted]}>
          <VideoNoteAttachment
            url={pendingVideoNote.uri}
            duration={pendingVideoNote.durationSeconds}
            outgoing={false}
            themeColors={themeColors}
          />
          <View style={styles.previewVideoNoteMeta}>
            <Text style={[styles.previewMetaText, themed.mutedText]}>
              Запись · {formatDuration(pendingVideoNote.durationSeconds)}
            </Text>
            <Text style={[styles.previewHint, themed.softText]}>
              Проверьте запись перед отправкой.
            </Text>
          </View>
          <View style={[styles.previewActions, styles.previewVideoNoteActions]}>
            <IconButton
              icon={Trash2}
              label="Удалить видео-сообщение"
              variant="danger"
              size="sm"
              onPress={onDeletePendingVideoNote}
              disabled={Boolean(sending)}
            />
            <IconButton
              icon={Send}
              label="Отправить видео-сообщение"
              variant="primary"
              size="sm"
              onPress={() => ignoreAsync(onSendPendingVideoNote())}
              disabled={Boolean(sending)}
            />
          </View>
        </View>
      ) : null}

      {pendingVoice ? (
        <View style={[styles.previewVoiceCard, themed.cardMuted]}>
          <View style={styles.previewVoiceRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                previewPlaying
                  ? 'Остановить прослушивание'
                  : 'Прослушать голосовое сообщение'
              }
              onPress={() => ignoreAsync(onTogglePreviewPlayback())}
              style={[
                styles.previewPlayButton,
                previewPlaying && styles.previewPlayButtonActive,
              ]}
              disabled={Boolean(sending)}
            >
              {previewPlaying ? (
                <Pause color={themeColors.white} size={16} strokeWidth={2.6} />
              ) : (
                <Play color={themeColors.white} size={16} strokeWidth={2.6} />
              )}
            </Pressable>

            <View
              ref={previewProgressBarRef}
              style={[styles.previewProgressBar, themed.previewProgressBar]}
              onStartShouldSetResponder={() => true}
              onResponderRelease={event =>
                ignoreAsync(onPreviewProgressPress(event))
              }
            >
              <View
                style={[
                  styles.previewProgressFill,
                  themed.previewProgressFill,
                  {
                    width: `${Math.min(
                      100,
                      ((previewPosition || 0) /
                        (pendingVoice.durationSeconds || 1)) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>

            <Text style={[styles.previewDuration, themed.mutedText]}>
              {formatDuration(previewPosition || 0)} /{' '}
              {formatDuration(pendingVoice.durationSeconds)}
            </Text>
          </View>

          <View style={styles.previewMeta}>
            <Text style={[styles.previewMetaText, themed.mutedText]}>
              {formatDuration(pendingVoice.durationSeconds)}
            </Text>
          </View>

          <View style={styles.previewActions}>
            <IconButton
              icon={Trash2}
              label="Удалить голосовое сообщение"
              variant="danger"
              size="sm"
              onPress={() => ignoreAsync(onDeletePendingVoice())}
              disabled={Boolean(sending)}
            />
            <IconButton
              icon={Send}
              label="Отправить голосовое сообщение"
              variant="primary"
              size="sm"
              onPress={() => ignoreAsync(onSendPendingVoice())}
              disabled={Boolean(sending)}
            />
          </View>
        </View>
      ) : null}

      {otherTyping ? (
        <View style={[styles.typingBar, themed.surfaceBar]}>
          <Text style={[styles.typingText, themed.mutedText]}>
            {otherName} печатает...
          </Text>
        </View>
      ) : null}

      <View style={[styles.composer, themed.composerSurface]}>
        <IconButton
          label="Прикрепить"
          variant="ghost"
          icon={Paperclip}
          disabled={
            Boolean(sending) ||
            Boolean(editingMessage) ||
            recording ||
            recordingBusy
          }
          onPress={() => ignoreAsync(onOpenAttachments())}
          style={[styles.composerSideButton, themed.composerSideButton]}
        />

        <View style={[styles.composerInputContainer, themed.composerInputContainer]}>
          <LiquidGlassView
            style={styles.composerBlur}
            glassType="regular"
            glassTintColor={themeColors.isDark ? '#1C1C22' : '#FFFFFF'}
            glassOpacity={themeColors.isDark ? 0.64 : 0.78}
            isInteractive={false}
            ignoreSafeArea={false}
          />

          <TextInput
            ref={inputRef}
            nativeID={CHAT_INPUT_NATIVE_ID}
            value={input}
            onChangeText={onInputChange}
            onFocus={onInputFocus}
            onContentSizeChange={event =>
              onInputContentSizeChange(event.nativeEvent.contentSize.height)
            }
            placeholder="Сообщение..."
            placeholderTextColor={themeColors.soft}
            multiline
            scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
            maxLength={1000}
            editable={!sending && !recording && !recordingBusy}
            textAlignVertical="top"
            style={[
              styles.input,
              themed.text,
              themed.composerInputText,
              { height: inputHeight },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Стикеры"
            accessibilityState={{
              disabled: Boolean(sending) || recording || recordingBusy,
            }}
            disabled={Boolean(sending) || recording || recordingBusy}
            hitSlop={6}
            onPress={onShowStickerNotice}
            style={({ pressed }) => [
              styles.composerEmojiButton,
              pressed && styles.composerButtonPressed,
              (Boolean(sending) || recording || recordingBusy) &&
                styles.composerButtonDisabled,
            ]}
          >
            <Smile color={themeColors.muted} size={21} strokeWidth={2.35} />
          </Pressable>
        </View>

        {showComposerSendButton ? (
          <IconButton
            label={editingMessage ? 'Сохранить сообщение' : 'Отправить'}
            icon={editingMessage ? Pencil : Send}
            variant="primary"
            disabled={
              Boolean(sending) ||
              messageActionPending ||
              recording ||
              recordingBusy ||
              (!trimmedInput &&
                !editingMessage &&
                pendingAttachments.length === 0) ||
              Boolean(pendingVoice) ||
              Boolean(pendingVideoNote)
            }
            loading={Boolean(sending)}
            onPress={() => ignoreAsync(onSendMessage())}
            style={styles.composerActionButton}
          />
        ) : (
          <IconButton
            label={composerMediaLabel}
            variant="primary"
            icon={composerMediaIcon}
            disabled={composerMediaDisabled}
            loading={recordingBusy}
            delayLongPress={LONG_PRESS_DELAY_MS}
            onPress={onToggleComposerMediaMode}
            onLongPress={() => ignoreAsync(onStartComposerMediaRecording())}
            onPressOut={onStopComposerMediaRecording}
            style={[
              styles.composerActionButton,
              recording ? styles.composerActionRecording : undefined,
            ]}
          />
        )}
      </View>
    </View>
  );
}
