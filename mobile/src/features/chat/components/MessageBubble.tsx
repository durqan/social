import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from 'react-native';
import { Download, Video as VideoIcon } from 'lucide-react-native';

import { DiagnosticVideo } from '../../../components/DiagnosticVideo';
import { assetURL } from '../../../config/env';
import type {
  Message,
  MessageAttachment,
  MessageLinkPreview,
} from '../../../api/types';
import type { ThemeColors } from '../../../theme/themes';
import { formatDuration, formatMessageTime } from '../../../utils/format';
import { createChatThemeStyles, styles } from '../lib/chatStyles';
import {
  formatBytes,
  linkParts,
  linkPreviewDomain,
  linkPreviewProviderLabel,
  messageAuthorName,
  messagePreviewText,
} from '../lib/chatUtils';

const messageListHorizontalPadding = 28;
const bubbleHorizontalPadding = 28;
const bubbleMaxWidthRatio = 0.82;
const maxAttachmentWidth = 236;
const minAttachmentWidth = 176;
const imageAspectRatio = 224 / 158;
const videoAspectRatio = 236 / 156;
const linkPreviewAspectRatio = 220 / 112;

function responsiveAttachmentWidth(windowWidth: number) {
  const bubbleContentWidth =
    (windowWidth - messageListHorizontalPadding) * bubbleMaxWidthRatio -
    bubbleHorizontalPadding;

  return Math.floor(
    Math.min(
      maxAttachmentWidth,
      Math.max(minAttachmentWidth, bubbleContentWidth),
    ),
  );
}

function linkPreviewImageURLs(preview: MessageLinkPreview) {
  const importedThumbnail = preview.video_attachment?.thumbnail_url;
  const candidates =
    preview.status === 'ready'
      ? [importedThumbnail, preview.image_url, preview.thumbnail_url]
      : [preview.image_url, preview.thumbnail_url, importedThumbnail];

  return candidates
    .filter(
      (url, index): url is string =>
        Boolean(url) && candidates.indexOf(url) === index,
    )
    .map(url => (/^(https?:|data:|blob:)/i.test(url) ? url : assetURL(url)));
}

function LinkPreviewCard({
                           message,
                           onImport,
                           themeColors,
                           width,
                         }: {
  message: Message;
  onImport: () => void;
  themeColors: ThemeColors;
  width: number;
}) {
  const themed = useMemo(
      () => createChatThemeStyles(themeColors),
      [themeColors],
  );

  const preview = message.link_preview;
  const previewImageURLs = useMemo(
    () => (preview ? linkPreviewImageURLs(preview) : []),
    [preview],
  );
  const previewImageKey = previewImageURLs.join('\n');
  const [failedImageURLs, setFailedImageURLs] = useState<string[]>([]);
  const previewImageURL =
    previewImageURLs.find(url => !failedImageURLs.includes(url)) || null;

  useEffect(() => {
    setFailedImageURLs([]);
  }, [previewImageKey]);

  if (!preview) {
    return null;
  }
  if (preview.status === 'ready' && preview.video_attachment_id) {
    return null;
  }

  const importing = preview.status === 'importing';
  const failed = preview.status === 'failed';

  return (
      <View
        style={[
          styles.linkPreviewCard,
          themed.linkPreviewCard,
          { width },
        ]}
      >
        {previewImageURL ? (
            <Image
                source={{ uri: previewImageURL }}
                style={[
                  styles.linkPreviewThumb,
                  { aspectRatio: linkPreviewAspectRatio },
                ]}
                onError={() =>
                  setFailedImageURLs(current =>
                    current.includes(previewImageURL)
                      ? current
                      : [...current, previewImageURL],
                  )
                }
            />
        ) : (
            <View
                style={[
                  styles.linkPreviewThumb,
                  styles.linkPreviewThumbPlaceholder,
                  themed.linkPreviewThumb,
                  { aspectRatio: linkPreviewAspectRatio },
                ]}
            >
              <VideoIcon size={30} color={themeColors.muted} />
            </View>
        )}

        <Text style={[styles.linkPreviewProvider, themed.linkPreviewProvider]}>
          {linkPreviewProviderLabel(preview.provider)}
        </Text>

        <Text
            style={[styles.linkPreviewTitle, themed.linkPreviewTitle]}
            numberOfLines={2}
        >
          {preview.title || 'Видео по ссылке'}
        </Text>

        <Text
            style={[styles.linkPreviewUrl, themed.linkPreviewUrl]}
            numberOfLines={1}
        >
          {linkPreviewDomain(preview.original_url)}
        </Text>

        {importing ? (
            <Text style={[styles.linkPreviewStatus, themed.linkPreviewStatus]}>
              Видео обрабатывается...
            </Text>
        ) : null}

        {failed ? (
            <Text style={[styles.linkPreviewFailed, themed.linkPreviewFailed]}>
              Не удалось сохранить видео
            </Text>
        ) : null}

        <View style={styles.linkPreviewActions}>
          {preview.status !== 'ready' ? (
              <Pressable
                  accessibilityRole="button"
                  disabled={importing}
                  style={[
                    styles.linkPreviewButton,
                    themed.linkPreviewButton,
                    importing && styles.linkPreviewButtonDisabled,
                  ]}
                  onPress={onImport}
              >
                <Text style={[styles.linkPreviewButtonText, themed.linkPreviewButtonText]}>
                  {failed ? 'Повторить' : 'Сохранить видео в чат'}
                </Text>
              </Pressable>
          ) : null}

          <Pressable
              accessibilityRole="link"
              style={[
                styles.linkPreviewSecondaryButton,
                themed.linkPreviewSecondaryButton,
              ]}
              onPress={() =>
                  Linking.openURL(preview.original_url).catch(() => undefined)
              }
          >
            <Text
                style={[
                  styles.linkPreviewSecondaryText,
                  themed.linkPreviewSecondaryText,
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
    const isOutgoing = status !== null;
    const ownTextIsWhite =
        themeColors.messageOwnText.toLowerCase() === '#ffffff';

    const mutedColor = isOutgoing
        ? ownTextIsWhite
            ? 'rgba(255,255,255,0.72)'
            : themeColors.muted
        : themeColors.isDark
            ? 'rgba(226,232,240,0.68)'
            : 'rgba(86,102,91,0.76)';

    const readColor = isOutgoing
        ? ownTextIsWhite
            ? 'rgba(255,255,255,0.9)'
            : themeColors.accentStrong
        : themeColors.isDark
            ? '#64d2c6'
            : '#229ed9';

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

export const MessageBubble = React.memo(function MessageBubbleComponent({
  message,
  outgoing,
  onImagePress,
  onVideoPress,
  onImportLinkPreviewVideo,
  onVoicePress,
  onDownloadAttachment,
  playingVoiceUrl,
  onTouchStart,
  onLongPressMessage,
  themeColors,
  groupedWithNext = false,
}: {
  message: Message;
  outgoing: boolean;
  onImagePress: (url: string) => void;
  onVideoPress: (url: string) => void;
  onImportLinkPreviewVideo: (message: Message) => void;
  onVoicePress: (url: string) => void;
  onDownloadAttachment: (
    attachment: MessageAttachment,
    sourceUrl: string,
  ) => void;
  playingVoiceUrl: string | null;
  onTouchStart?: (event: GestureResponderEvent) => void;
  onLongPressMessage: (message: Message) => void;
  themeColors: ThemeColors;
  groupedWithNext?: boolean;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const { width: windowWidth } = useWindowDimensions();
  const attachmentWidth = responsiveAttachmentWidth(windowWidth);
  const imageWidth = Math.min(224, attachmentWidth);
  const videoHeight = attachmentWidth / videoAspectRatio;
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
  const textHasHardBreak = displayContent.includes('\n');
  const displayParts = useMemo(
    () => linkParts(displayContent),
    [displayContent],
  );
  const shortInlineFooter =
    textOnlyMessage && !textHasHardBreak && displayContent.trim().length <= 14;
  const showFloatingFooter = !shortInlineFooter;
  const [footerWidth, setFooterWidth] = useState(0);
  const trailingTextNeedsFooterReserve =
    showFloatingFooter &&
    Boolean(displayContent) &&
    !message.link_preview &&
    !hasAttachments;
  const floatingFooterReserveStyle =
    footerWidth > 0 && trailingTextNeedsFooterReserve
      ? { paddingRight: Math.max(14, footerWidth + 18) }
      : null;

  const handleFooterLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setFooterWidth(current =>
      Math.abs(current - nextWidth) > 0.5 ? nextWidth : current,
    );
  };
  const handleLongPress = useCallback(() => {
    onLongPressMessage(message);
  }, [message, onLongPressMessage]);

  const renderDownloadButton = (
    attachment: MessageAttachment,
    sourceUrl: string,
    floating = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Скачать вложение"
      hitSlop={8}
      style={[
        styles.attachmentDownloadButton,
        floating && styles.attachmentDownloadButtonFloating,
      ]}
      onPress={event => {
        event.stopPropagation();
        onDownloadAttachment(attachment, sourceUrl);
      }}
      onLongPress={event => {
        event.stopPropagation();
      }}
    >
      <Download color={themeColors.white} size={17} strokeWidth={2.4} />
    </Pressable>
  );

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
      onTouchStart={onTouchStart}
      onLongPress={handleLongPress}
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
            style={[
              styles.messageText,
              themed.messageBodyText,
              outgoing ? themed.outgoingMessageText : themed.messageText,
            ]}
          >
            {displayParts.map((part, index) => {
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

            {shortInlineFooter ? (
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
            themeColors={themeColors}
            width={attachmentWidth}
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
                accessibilityLabel={`${isPlaying ? 'Остановить' : 'Воспроизвести'} голосовое сообщение, ${formatDuration(
                  attachment.duration_seconds ?? attachment.duration,
                )}`}
                accessibilityState={{ selected: isPlaying }}
                style={[
                  styles.voiceAttachment,
                  { width: attachmentWidth },
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onVoicePress(attachmentUrl)}
                onLongPress={handleLongPress}
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
                {renderDownloadButton(attachment, attachmentUrl)}
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
                onLongPress={handleLongPress}
                themeColors={themeColors}
              />
            );
          }

          if (attachment.file_type === 'video') {
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                accessibilityLabel={`Воспроизвести видео: ${
                  attachment.original_filename || 'Видео'
                }`}
                style={[
                  styles.genericVideoAttachment,
                  { width: attachmentWidth },
                ]}
                onPress={() => onVideoPress(attachmentUrl)}
                onLongPress={handleLongPress}
              >
                {attachment.thumbnail_url ? (
                  <Image
                    source={{ uri: assetURL(attachment.thumbnail_url) }}
                    style={[
                      styles.genericVideo,
                      { width: attachmentWidth },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.genericVideo,
                      styles.genericVideoPlaceholder,
                      { width: attachmentWidth },
                    ]}
                  >
                    <VideoIcon size={34} color="#fff" />
                  </View>
                )}
                <View
                  pointerEvents="none"
                  style={[
                    styles.genericVideoPlay,
                    {
                      left: (attachmentWidth - 44) / 2,
                      top: (videoHeight - 44) / 2,
                    },
                  ]}
                >
                  <Text style={styles.genericVideoPlayText}>▶</Text>
                </View>
                {renderDownloadButton(attachment, attachmentUrl, true)}
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
                accessibilityLabel={`${isPlaying ? 'Остановить' : 'Воспроизвести'} аудиофайл: ${
                  attachment.original_filename || 'Аудио'
                }`}
                accessibilityState={{ selected: isPlaying }}
                style={[
                  styles.genericFileAttachment,
                  { width: attachmentWidth },
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onVoicePress(attachmentUrl)}
                onLongPress={handleLongPress}
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
                {renderDownloadButton(attachment, attachmentUrl)}
              </Pressable>
            );
          }

          if (attachment.file_type === 'file') {
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                accessibilityLabel={`Скачать файл: ${
                  attachment.original_filename || 'Файл'
                }`}
                style={[
                  styles.genericFileAttachment,
                  { width: attachmentWidth },
                  themed.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onDownloadAttachment(attachment, attachmentUrl)}
                onLongPress={handleLongPress}
              >
                <View style={[styles.genericFileIcon, themed.accentBg]}>
                  <Download
                    color={themeColors.white}
                    size={19}
                    strokeWidth={2.4}
                  />
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
                {renderDownloadButton(attachment, attachmentUrl)}
              </Pressable>
            );
          }

          return (
            <View
              key={attachment.id ?? attachment.file_url}
              style={[
                styles.messageImageFrame,
                { width: imageWidth, aspectRatio: imageAspectRatio },
              ]}
            >
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="Открыть изображение"
                onPress={() => onImagePress(attachmentUrl)}
                onLongPress={handleLongPress}
              >
                <Image
                  source={{ uri: attachmentUrl }}
                  style={[
                    styles.messageImage,
                    { width: imageWidth, aspectRatio: imageAspectRatio },
                  ]}
                  resizeMode="cover"
                />
              </Pressable>
              {renderDownloadButton(attachment, attachmentUrl, true)}
            </View>
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
  const { width: windowWidth } = useWindowDimensions();
  const orbitSize = Math.min(
    104,
    Math.max(
      88,
      Math.round(responsiveAttachmentWidth(windowWidth) * 0.49),
    ),
  );
  const videoSize = orbitSize - 4;
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(duration ?? 0);
  const videoSource = useMemo(() => ({ uri: url }), [url]);
  const effectiveDuration = loadedDuration || duration || 0;
  const progress =
    effectiveDuration > 0
      ? Math.min(1, Math.max(0, position / effectiveDuration))
      : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${playing ? 'Остановить' : 'Воспроизвести'} видеосообщение, ${formatDuration(
        effectiveDuration,
      )}`}
      accessibilityState={{ selected: playing }}
      style={[
        styles.videoNoteAttachment,
        { width: orbitSize + 12 },
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
          {
            width: orbitSize,
            height: orbitSize,
            borderRadius: orbitSize / 2,
          },
        ]}
      >
        {playing ? (
          <DiagnosticVideo
            source={videoSource}
            style={[
              styles.videoNoteVideo,
              themed.surfaceMuted,
              {
                width: videoSize,
                height: videoSize,
                borderRadius: videoSize / 2,
              },
            ]}
            paused={false}
            repeat={false}
            resizeMode="cover"
            muted={false}
            diagnosticLabel="chat-video-note"
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
          <View
            style={[
              styles.videoNoteVideo,
              styles.videoNotePlaceholder,
              {
                width: videoSize,
                height: videoSize,
                borderRadius: videoSize / 2,
              },
            ]}
          >
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
