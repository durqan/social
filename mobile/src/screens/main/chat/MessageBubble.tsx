import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  useWindowDimensions,
} from 'react-native';
import Video from 'react-native-video';
import { Video as VideoIcon } from 'lucide-react-native';

import { assetURL } from '../../../config/env';
import type { Message } from '../../../api/types';
import type { ThemeColors } from '../../../theme/themes';
import { formatDuration, formatMessageTime } from '../../../utils/format';
import { createChatThemeStyles, styles } from './chatStyles';
import {
  formatBytes,
  linkParts,
  linkPreviewDomain,
  linkPreviewProviderLabel,
  messageAuthorName,
  messagePreviewText,
} from './chatUtils';

function LinkPreviewCard({
  message,
  outgoing,
  hasVideo,
  onImport,
  themeColors,
}: {
  message: Message;
  outgoing: boolean;
  hasVideo: boolean;
  onImport: () => void;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const preview = message.link_preview;
  if (!preview) {
    return null;
  }
  if (preview.status === 'ready' && hasVideo) {
    return (
      <Text
        style={[
          styles.linkPreviewSource,
          outgoing ? themed.outgoingSoftText : themed.mutedText,
        ]}
      >
        Источник: {linkPreviewProviderLabel(preview.provider)}
      </Text>
    );
  }

  const importing = preview.status === 'importing';
  const failed = preview.status === 'failed';
  return (
    <View style={[styles.linkPreviewCard, themed.voiceAttachment]}>
      {preview.thumbnail_url ? (
        <Image
          source={{ uri: preview.thumbnail_url }}
          style={styles.linkPreviewThumb}
        />
      ) : (
        <View
          style={[styles.linkPreviewThumb, styles.linkPreviewThumbPlaceholder]}
        >
          <VideoIcon size={30} color={themeColors.muted} />
        </View>
      )}
      <Text
        style={[
          styles.linkPreviewProvider,
          outgoing ? themed.outgoingSoftText : themed.mutedText,
        ]}
      >
        {linkPreviewProviderLabel(preview.provider)}
      </Text>
      <Text
        style={[
          styles.linkPreviewTitle,
          outgoing ? themed.outgoingMessageText : themed.text,
        ]}
        numberOfLines={2}
      >
        {preview.title || 'Видео по ссылке'}
      </Text>
      <Text
        style={[
          styles.linkPreviewUrl,
          outgoing ? themed.outgoingSoftText : themed.mutedText,
        ]}
        numberOfLines={1}
      >
        {linkPreviewDomain(preview.original_url)}
      </Text>
      {importing ? (
        <Text
          style={[
            styles.linkPreviewStatus,
            outgoing ? themed.outgoingSoftText : themed.mutedText,
          ]}
        >
          Видео обрабатывается...
        </Text>
      ) : null}
      {failed ? (
        <Text style={styles.linkPreviewFailed}>Не удалось сохранить видео</Text>
      ) : null}
      <View style={styles.linkPreviewActions}>
        {preview.status !== 'ready' ? (
          <Pressable
            accessibilityRole="button"
            disabled={importing}
            style={[
              styles.linkPreviewButton,
              importing && styles.linkPreviewButtonDisabled,
            ]}
            onPress={onImport}
          >
            <Text style={styles.linkPreviewButtonText}>
              {failed ? 'Повторить' : 'Сохранить видео в чат'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="link"
          style={styles.linkPreviewSecondaryButton}
          onPress={() =>
            Linking.openURL(preview.original_url).catch(() => undefined)
          }
        >
          <Text
            style={[
              styles.linkPreviewSecondaryText,
              outgoing ? themed.outgoingMessageText : themed.text,
            ]}
          >
            Открыть
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type MessageStatusKind = 'sent' | 'read';

function outgoingStatus(message: Message, outgoing: boolean): MessageStatusKind | null {
  if (!outgoing) {
    return null;
  }

  return message.is_read ? 'read' : 'sent';
}

function statusChecks(status: MessageStatusKind | null) {
  if (!status) {
    return '';
  }

  return status === 'read' ? '✓✓' : '✓';
}

function MessageFooterText({
  time,
  status,
  themeColors,
}: {
  time: string;
  status: MessageStatusKind | null;
  themeColors: ThemeColors;
}) {
  const checks = statusChecks(status);
  const mutedColor = themeColors.isDark
    ? 'rgba(226, 232, 240, 0.68)'
    : 'rgba(86, 102, 91, 0.76)';
  const readColor = themeColors.isDark ? '#64d2c6' : '#229ed9';

  return (
    <>
      <Text style={[styles.messageFooterTime, { color: mutedColor }]}>
        {time}
      </Text>
      {checks ? (
        <Text
          style={[
            styles.messageFooterChecks,
            { color: status === 'read' ? readColor : mutedColor },
          ]}
        >
          {checks}
        </Text>
      ) : null}
    </>
  );
}

function MessageFooterView({
  time,
  status,
  themeColors,
  onLayout,
  measureOnly = false,
}: {
  time: string;
  status: MessageStatusKind | null;
  themeColors: ThemeColors;
  onLayout?: (event: LayoutChangeEvent) => void;
  measureOnly?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.messageFooter,
        measureOnly && styles.messageFooterMeasure,
      ]}
      onLayout={onLayout}
    >
      <MessageFooterText
        time={time}
        status={status}
        themeColors={themeColors}
      />
    </View>
  );
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  outgoing,
  onImagePress,
  onVideoPress,
  onImportLinkPreviewVideo,
  onVoicePress,
  playingVoiceUrl,
  onLongPress,
  themeColors,
  groupedWithNext = false,
}: {
  message: Message;
  outgoing: boolean;
  onImagePress: (url: string) => void;
  onVideoPress: (url: string) => void;
  onImportLinkPreviewVideo: (message: Message) => void;
  onVoicePress: (url: string) => void;
  playingVoiceUrl: string | null;
  onLongPress: () => void;
  themeColors: ThemeColors;
  groupedWithNext?: boolean;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const windowDimensions = useWindowDimensions();
  const displayContent =
    message.content ||
    (message.encryption_version && message.encryption_version > 0
      ? 'Не удалось расшифровать сообщение'
      : '');
  const footerTime = formatMessageTime(message.created_at);
  const footerStatus = outgoingStatus(message, outgoing);
  const hasAttachments = Boolean(message.attachments?.length);
  const hasBlockContent = Boolean(
    message.forwarded_from_message_id ||
      message.reply_to_message_id ||
      message.link_preview ||
      hasAttachments,
  );
  const textOnlyMessage = Boolean(displayContent) && !hasBlockContent;
  const [footerWidth, setFooterWidth] = useState(0);
  const [textMetrics, setTextMetrics] = useState({
    lineCount: 0,
    lastLineWidth: 0,
  });
  const textHasHardBreak = displayContent.includes('\n');
  const maxBubbleContentWidth = Math.max(
    0,
    (windowDimensions.width - 20) * 0.78 - 24,
  );
  const canInlineFooter =
    textOnlyMessage &&
    !textHasHardBreak &&
    textMetrics.lineCount === 1 &&
    footerWidth > 0 &&
    textMetrics.lastLineWidth + footerWidth + 12 <=
      maxBubbleContentWidth;
  const showFloatingFooter = !canInlineFooter;
  const trailingTextNeedsFooterReserve = Boolean(displayContent) &&
    !message.link_preview &&
    !hasAttachments;
  const floatingFooterReserveStyle =
    showFloatingFooter && footerWidth > 0 && trailingTextNeedsFooterReserve
      ? { paddingRight: Math.max(14, footerWidth + 22) }
      : null;

  useEffect(() => {
    setTextMetrics({ lineCount: 0, lastLineWidth: 0 });
  }, [displayContent]);

  const handleFooterLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setFooterWidth(current =>
      Math.abs(current - nextWidth) > 0.5 ? nextWidth : current,
    );
  };

  const handleTextLayout = (
    event: NativeSyntheticEvent<TextLayoutEventData>,
  ) => {
    if (canInlineFooter) {
      return;
    }

    const lines = event.nativeEvent.lines;
    const lastLine = lines[lines.length - 1];
    const nextMetrics = {
      lineCount: lines.length,
      lastLineWidth: lastLine?.width ?? 0,
    };

    setTextMetrics(current =>
      current.lineCount === nextMetrics.lineCount &&
      Math.abs(current.lastLineWidth - nextMetrics.lastLineWidth) <= 0.5
        ? current
        : nextMetrics,
    );
  };

  return (
    <Pressable
      style={[
        styles.bubbleRow,
        outgoing && styles.bubbleRowOutgoing,
        groupedWithNext
          ? styles.bubbleRowGroupedSpacing
          : styles.bubbleRowSpacing,
      ]}
      delayLongPress={280}
      onLongPress={onLongPress}
    >
      <View
        style={[
          styles.bubble,
          outgoing ? styles.outgoing : styles.incoming,
          outgoing ? themed.outgoingBubble : themed.incomingBubble,
          showFloatingFooter && styles.bubbleWithFloatingFooter,
          floatingFooterReserveStyle,
        ]}
      >
        <MessageFooterView
          time={footerTime}
          status={footerStatus}
          themeColors={themeColors}
          onLayout={handleFooterLayout}
          measureOnly
        />

        {message.forwarded_from_message_id ? (
          <Text
            style={[
              styles.forwardedLabel,
              outgoing ? themed.outgoingAccentText : themed.accentText,
            ]}
          >
            {message.forwarded_from_user?.name
              ? `↪ Переслано от ${message.forwarded_from_user.name}`
              : '↪ Пересланное сообщение'}
          </Text>
        ) : null}

        {message.reply_to_message_id ? (
          <View
            style={[
              styles.replyPreview,
              themed.replyPreview,
              outgoing && styles.replyPreviewOutgoing,
            ]}
          >
            <Text
              style={[
                styles.replyPreviewAuthor,
                outgoing ? themed.outgoingAccentText : themed.accentText,
              ]}
            >
              {message.reply_to_message
                ? messageAuthorName(message.reply_to_message)
                : 'Ответ'}
            </Text>
            <Text
              style={[
                styles.replyPreviewText,
                outgoing ? themed.outgoingMutedText : themed.mutedText,
              ]}
              numberOfLines={1}
            >
              {messagePreviewText(message.reply_to_message)}
            </Text>
          </View>
        ) : null}

        {displayContent ? (
          <Text
            selectable
            onTextLayout={handleTextLayout}
            style={[
              styles.messageText,
              themed.messageBodyText,
              outgoing ? themed.outgoingMessageText : themed.messageText,
            ]}
          >
            {linkParts(displayContent).map((part, index) => {
              if (part.type === 'link' && part.href) {
                return (
                  <Text
                    key={`${part.href}-${index}`}
                    style={[
                      styles.messageLink,
                      outgoing ? themed.outgoingLink : themed.accentText,
                    ]}
                    onPress={() =>
                      Linking.openURL(part.href ?? '').catch(() => undefined)
                    }
                  >
                    {part.value}
                  </Text>
                );
              }

              return part.value;
            })}
            {canInlineFooter ? (
              <Text style={styles.messageInlineFooter}>
                {'  '}
                <MessageFooterText
                  time={footerTime}
                  status={footerStatus}
                  themeColors={themeColors}
                />
              </Text>
            ) : null}
          </Text>
        ) : null}

        {message.link_preview ? (
          <LinkPreviewCard
            message={message}
            outgoing={outgoing}
            themeColors={themeColors}
            hasVideo={Boolean(
              message.attachments?.some(
                attachment =>
                  attachment.file_type === 'video' &&
                  !attachment.decryption_error,
              ),
            )}
            onImport={() => onImportLinkPreviewVideo(message)}
          />
        ) : null}

        {message.attachments?.map(attachment => {
          if (
            ((attachment.encryption_version ?? 0) > 0 &&
              !attachment.decrypted_file_url) ||
            attachment.decryption_error
          ) {
            return (
              <View
                key={attachment.id ?? attachment.file_url}
                style={[
                  styles.attachmentDecryptError,
                  themed.dangerSoft,
                  outgoing && styles.attachmentDecryptErrorOutgoing,
                ]}
              >
                <Text
                  style={[
                    styles.attachmentDecryptErrorText,
                    !outgoing && themed.dangerText,
                    outgoing && styles.attachmentDecryptErrorTextOutgoing,
                  ]}
                >
                  Не удалось расшифровать вложение
                </Text>
              </View>
            );
          }

          const attachmentUrl =
            attachment.decrypted_file_url || assetURL(attachment.file_url);

          if (attachment.file_type === 'voice') {
            const isPlaying = playingVoiceUrl === attachmentUrl;
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                style={[
                  styles.voiceAttachment,
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onVoicePress(attachmentUrl)}
                onLongPress={onLongPress}
              >
                <View
                  style={[
                    styles.voicePlayButton,
                    themed.accentBg,
                    isPlaying && styles.voicePlayButtonActive,
                  ]}
                >
                  <Text style={styles.voicePlayText}>
                    {isPlaying ? 'Ⅱ' : '▶'}
                  </Text>
                </View>
                <View style={styles.voiceInfo}>
                  <Text
                    style={[
                      styles.voiceTitle,
                      outgoing ? themed.outgoingMessageText : themed.text,
                    ]}
                  >
                    Голосовое сообщение
                  </Text>
                  <Text
                    style={[
                      styles.voiceDuration,
                      outgoing ? themed.outgoingSoftText : themed.mutedText,
                    ]}
                  >
                    {formatDuration(
                      attachment.duration_seconds ?? attachment.duration,
                    )}
                  </Text>
                </View>
              </Pressable>
            );
          }

          if (attachment.file_type === 'video_note') {
            return (
              <VideoNoteAttachment
                key={attachment.id ?? attachment.file_url}
                url={attachmentUrl}
                duration={attachment.duration_seconds ?? attachment.duration}
                outgoing={outgoing}
                onLongPress={onLongPress}
                themeColors={themeColors}
              />
            );
          }

          if (attachment.file_type === 'video') {
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                style={styles.genericVideoAttachment}
                onPress={() => onVideoPress(attachmentUrl)}
                onLongPress={onLongPress}
              >
                {attachment.thumbnail_url ? (
                  <Image
                    source={{ uri: assetURL(attachment.thumbnail_url) }}
                    style={styles.genericVideo}
                  />
                ) : (
                  <View
                    style={[
                      styles.genericVideo,
                      styles.genericVideoPlaceholder,
                    ]}
                  >
                    <VideoIcon size={34} color="#fff" />
                  </View>
                )}
                <View style={styles.genericVideoPlay}>
                  <Text style={styles.genericVideoPlayText}>▶</Text>
                </View>
                <Text
                  style={[
                    styles.genericAttachmentMeta,
                    outgoing ? themed.outgoingSoftText : themed.mutedText,
                  ]}
                  numberOfLines={1}
                >
                  {attachment.original_filename || 'Видео'}
                </Text>
              </Pressable>
            );
          }

          if (attachment.file_type === 'audio') {
            const isPlaying = playingVoiceUrl === attachmentUrl;
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                style={[
                  styles.genericFileAttachment,
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onVoicePress(attachmentUrl)}
                onLongPress={onLongPress}
              >
                <View
                  style={[
                    styles.voicePlayButton,
                    themed.accentBg,
                    isPlaying && styles.voicePlayButtonActive,
                  ]}
                >
                  <Text style={styles.voicePlayText}>
                    {isPlaying ? 'Ⅱ' : '▶'}
                  </Text>
                </View>
                <View style={styles.voiceInfo}>
                  <Text
                    style={[
                      styles.voiceTitle,
                      outgoing ? themed.outgoingMessageText : themed.text,
                    ]}
                    numberOfLines={1}
                  >
                    {attachment.original_filename || 'Аудио'}
                  </Text>
                  <Text
                    style={[
                      styles.voiceDuration,
                      outgoing ? themed.outgoingSoftText : themed.mutedText,
                    ]}
                  >
                    {formatBytes(attachment.original_size || attachment.size)}
                  </Text>
                </View>
              </Pressable>
            );
          }

          if (attachment.file_type === 'file') {
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                style={[
                  styles.genericFileAttachment,
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() =>
                  Linking.openURL(attachmentUrl).catch(() => undefined)
                }
                onLongPress={onLongPress}
              >
                <View style={[styles.genericFileIcon, themed.accentBg]}>
                  <Text style={styles.genericFileIconText}>↓</Text>
                </View>
                <View style={styles.voiceInfo}>
                  <Text
                    style={[
                      styles.voiceTitle,
                      outgoing ? themed.outgoingMessageText : themed.text,
                    ]}
                    numberOfLines={1}
                  >
                    {attachment.original_filename || 'Файл'}
                  </Text>
                  <Text
                    style={[
                      styles.voiceDuration,
                      outgoing ? themed.outgoingSoftText : themed.mutedText,
                    ]}
                  >
                    {formatBytes(attachment.original_size || attachment.size)}
                  </Text>
                </View>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={attachment.id ?? attachment.file_url}
              accessibilityRole="imagebutton"
              onPress={() => onImagePress(attachmentUrl)}
              onLongPress={onLongPress}
            >
              <Image
                source={{ uri: attachmentUrl }}
                style={styles.messageImage}
                resizeMode="cover"
              />
            </Pressable>
          );
        })}

        {showFloatingFooter ? (
          <MessageFooterView
            time={footerTime}
            status={footerStatus}
            themeColors={themeColors}
          />
        ) : null}
      </View>
    </Pressable>
  );
});

export function VideoNoteAttachment({
  url,
  duration,
  outgoing,
  onLongPress,
  themeColors,
}: {
  url: string;
  duration?: number;
  outgoing: boolean;
  onLongPress?: () => void;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(duration ?? 0);
  const effectiveDuration = loadedDuration || duration || 0;
  const progress =
    effectiveDuration > 0
      ? Math.min(1, Math.max(0, position / effectiveDuration))
      : 0;

  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.videoNoteAttachment,
        outgoing && styles.videoNoteAttachmentOutgoing,
      ]}
      onPress={() => setPlaying(value => !value)}
      onLongPress={onLongPress}
    >
      <View
        style={[
          styles.videoNoteOrbit,
          themed.videoNoteOrbit,
          playing && styles.videoNoteOrbitActive,
          playing && themed.videoNoteOrbitActive,
        ]}
      >
        {playing ? (
          <Video
            source={{ uri: url }}
            style={[styles.videoNoteVideo, themed.surfaceMuted]}
            paused={false}
            repeat={false}
            resizeMode="cover"
            muted={false}
            onLoad={data => {
              setLoadedDuration(data.duration || duration || 0);
            }}
            onProgress={data => {
              setPosition(data.currentTime || 0);
            }}
            onEnd={() => {
              setPlaying(false);
              setPosition(0);
            }}
            onError={() => {
              setPlaying(false);
            }}
          />
        ) : (
          <View style={[styles.videoNoteVideo, styles.videoNotePlaceholder]}>
            <VideoIcon size={28} color={themeColors.white} />
          </View>
        )}
        <View
          style={[styles.videoNoteGlassButton, themed.videoNoteGlassButton]}
        >
          <Text style={styles.videoNoteIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
        </View>
      </View>
      <View style={[styles.videoNotePill, themed.videoNotePill]}>
        <View
          style={[
            styles.videoNotePillProgress,
            themed.videoNotePillProgress,
            { width: `${progress * 100}%` },
          ]}
        />
        <Text
          style={[styles.videoNoteText, outgoing && themed.outgoingMessageText]}
        >
          {formatDuration(effectiveDuration)}
        </Text>
      </View>
    </Pressable>
  );
}
