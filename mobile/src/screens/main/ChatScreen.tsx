import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Clipboard,
  FlatList,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import {
  Copy,
  Forward,
  ImagePlus,
  Link,
  Mic,
  Pause,
  Pencil,
  Phone,
  Pin,
  Play,
  Reply,
  Send,
  Trash2,
  Video as VideoIcon,
} from 'lucide-react-native';
import Sound, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';
import Video from 'react-native-video';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { WS_EVENTS } from '@social/shared';

import {
  assetURL,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
} from '../../config/env';
import { e2eeApi } from '../../api/e2ee';
import { friendsApi } from '../../api/friends';
import { getApiErrorMessage, getCookieHeader } from '../../api/http';
import {
  messageApi,
  validateLocalChatImage,
  validateLocalVideoNoteMessage,
  validateLocalVoiceMessage,
  type LocalChatImage,
  type LocalVideoNoteMessage,
  type LocalVoiceMessage,
  type UploadFilePart,
} from '../../api/messages';
import type {
  Message,
  MessageAttachment,
  PinnedMessage,
  User,
} from '../../api/types';
import { chatSocket, type WsEvent } from '../../api/ws';
import { IconButton } from '../../components/IconButton';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  SuccessBanner,
} from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { useAppLifecycle } from '../../context/AppLifecycleContext';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/layout';
import type { ThemeColors } from '../../theme/themes';
import { formatDateTime, formatDuration } from '../../utils/format';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';
import type { ChatStackParamList } from '../../navigation/types';
import {
  encryptAttachmentForUpload,
  isEncryptedAttachment,
  localSourceFromAttachment,
  withDecryptedAttachmentPreview,
  type AttachmentFileType,
  type LocalAttachmentSource,
} from '../../crypto/attachment';
import {
  encryptMessage,
  type EncryptedMessagePayload,
} from '../../crypto/encryptMessage';
import {
  addLocalE2EEKeyChangeListener,
  getLocalE2EEKeyBundle,
  type LocalE2EEKeyBundle,
} from '../../crypto/masterKey';
import {
  decryptMessageForDisplay,
  decryptMessagesForDisplay,
} from '../../features/chat/lib/e2eeMessageTransform';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;
type LoadMode = 'initial' | 'refresh' | 'silent';
type ChatE2EEState = {
  loading: boolean;
  selfEnabled: boolean;
  recipientEnabled: boolean;
  recipientPublicKey: string;
  localKey: LocalE2EEKeyBundle | null;
};
const composerInputMinHeight = 48;
const composerInputMaxHeight = 136;
const messagePageSize = 50;
const loadOlderThreshold = 56;
const voiceAudioSet = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.WEBM,
  AudioEncoderAndroid: AudioEncoderAndroidType.VORBIS,
  AudioChannels: 1,
  AudioSamplingRate: 44100,
  AudioEncodingBitRate: 64000,
} as const;

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function cleanUrl(value: string) {
  return value.replace(/[),.!?;:]+$/, '');
}

function normalizeUrl(value: string) {
  return value.startsWith('www.') ? `https://${value}` : value;
}

function firstUrl(value: string) {
  const match = value.match(urlPattern)?.[0];
  return match ? normalizeUrl(cleanUrl(match)) : '';
}

function estimateComposerInputHeight(value: string) {
  if (!value) {
    return composerInputMinHeight;
  }

  const hardLines = value.split('\n').length;
  const softLines = Math.ceil(value.length / 36);
  const estimatedLines = Math.max(hardLines, softLines);
  return Math.min(
    composerInputMaxHeight,
    Math.max(composerInputMinHeight, 28 + estimatedLines * 22),
  );
}

function messageUpdateTime(message: Message) {
  if (!message.updated_at) {
    return null;
  }

  const time = Date.parse(message.updated_at);
  return Number.isFinite(time) ? time : null;
}

function shouldApplyMessageUpdate(current: Message, updated: Message) {
  const currentTime = messageUpdateTime(current);
  const updatedTime = messageUpdateTime(updated);

  if (currentTime === null || updatedTime === null) {
    return true;
  }

  return updatedTime >= currentTime;
}

function messageAuthorName(message?: Message | null) {
  if (!message) {
    return 'Сообщение';
  }
  return message.from?.name || 'Пользователь';
}

function messagePreviewText(message?: Message | null) {
  if (!message) {
    return 'Сообщение недоступно';
  }
  if (message.decryption_error) {
    return 'Не удалось расшифровать сообщение';
  }
  const content = message.content?.trim();
  if (content) {
    return content.length > 80 ? `${content.slice(0, 77)}...` : content;
  }
  if ((message.encryption_version ?? 0) > 0) {
    return 'Зашифрованное сообщение';
  }
  if (message.attachments?.some(attachment => attachment.decryption_error)) {
    return 'Не удалось расшифровать вложение';
  }
  const attachment = message.attachments?.[0];
  if (!attachment) {
    return 'Сообщение недоступно';
  }
  if (attachment.file_type === 'voice') {
    return 'Голосовое сообщение';
  }
  if (attachment.file_type === 'video_note') {
    return 'Видео-сообщение';
  }
  return 'Вложение';
}

function chatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'E2EE is not ready for this conversation' ||
      error.message === 'Recipient E2EE is not enabled'
    ) {
      return 'Сквозное шифрование недоступно: восстановите ключ или попросите собеседника включить E2EE.';
    }
  }

  return getApiErrorMessage(error);
}

function linkParts(value: string) {
  const parts: Array<{ type: 'text' | 'link'; value: string; href?: string }> =
    [];
  let lastIndex = 0;

  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;
    const cleanedUrl = cleanUrl(rawUrl);

    if (index > lastIndex) {
      parts.push({ type: 'text', value: value.slice(lastIndex, index) });
    }

    parts.push({
      type: 'link',
      value: cleanedUrl,
      href: normalizeUrl(cleanedUrl),
    });

    if (cleanedUrl.length < rawUrl.length) {
      parts.push({ type: 'text', value: rawUrl.slice(cleanedUrl.length) });
    }

    lastIndex = index + rawUrl.length;
  }

  if (lastIndex < value.length) {
    parts.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return parts;
}

export default function ChatScreen({ route }: Props) {
  const { user } = useAuth();
  const themeColors = useThemeColors();
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const { startAudioCall, startVideoCall, status: callStatus } = useCall();
  const isFocused = useIsFocused();
  const { isForeground, networkConnected } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const otherUserId = route.params.userId;
  const listRef = useRef<FlatList<Message>>(null);
  const hasLoadedRef = useRef(false);
  const hasMoreRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const shouldScrollToEndRef = useRef(false);
  const draftRef = useRef<{
    input: string;
    pendingImages: LocalChatImage[];
  } | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingSecondsRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const recordingMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const playingVoiceUrlRef = useRef<string | null>(null);
  const previewPlayingRef = useRef<boolean>(false);
  const pendingVoiceRef = useRef<LocalVoiceMessage | null>(null);
  const previewProgressBarRef = useRef<View>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const otherTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previousNetworkConnectedRef = useRef(networkConnected);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(composerInputMinHeight);
  const [pendingImages, setPendingImages] = useState<LocalChatImage[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(
    null,
  );
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardFriends, setForwardFriends] = useState<User[]>([]);
  const [forwardSelectedIds, setForwardSelectedIds] = useState<Set<number>>(
    new Set(),
  );
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sending, setSending] = useState<
    'uploading' | 'uploadingVoice' | 'uploadingVideoNote' | 'sending' | null
  >(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingVoiceUrl, setPlayingVoiceUrl] = useState<string | null>(null);

  const [pendingVoice, setPendingVoice] = useState<LocalVoiceMessage | null>(
    null,
  );
  const [pendingVideoNote, setPendingVideoNote] =
    useState<LocalVideoNoteMessage | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [otherTyping, setOtherTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [e2eeState, setE2eeState] = useState<ChatE2EEState>({
    loading: true,
    selfEnabled: false,
    recipientEnabled: false,
    recipientPublicKey: '',
    localKey: null,
  });
  const e2eeReady = Boolean(
    user?.id &&
      e2eeState.selfEnabled &&
      e2eeState.recipientEnabled &&
      e2eeState.recipientPublicKey &&
      e2eeState.localKey,
  );

  const pendingImagesRef = useRef<LocalChatImage[]>([]);
  const sendingRef = useRef<
    'uploading' | 'uploadingVoice' | 'uploadingVideoNote' | 'sending' | null
  >(null);
  const editingMessageRef = useRef<Message | null>(null);
  const replyToMessageRef = useRef<Message | null>(null);
  const recordingBusyRef = useRef<boolean>(false);
  const startVoiceRecordingRef = useRef<() => Promise<void> | void>(
    null as any,
  );
  const stopVoiceRecordingRef = useRef<(send: boolean) => Promise<void> | void>(
    null as any,
  );

  useEffect(() => {
    if (!copyNotice) {
      return undefined;
    }

    const timer = setTimeout(() => setCopyNotice(null), 1600);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    playingVoiceUrlRef.current = playingVoiceUrl;
  }, [playingVoiceUrl]);

  useEffect(() => {
    pendingVoiceRef.current = pendingVoice;
  }, [pendingVoice]);

  useEffect(() => {
    previewPlayingRef.current = previewPlaying;
  }, [previewPlaying]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    editingMessageRef.current = editingMessage;
  }, [editingMessage]);

  useEffect(() => {
    replyToMessageRef.current = replyToMessage;
  }, [replyToMessage]);
  useEffect(() => {
    recordingBusyRef.current = recordingBusy;
  }, [recordingBusy]);

  useEffect(() => {
    return () => {
      if (recordingMaxTimerRef.current) {
        clearTimeout(recordingMaxTimerRef.current);
      }
      Sound.removeRecordBackListener();
      Sound.removePlaybackEndListener();
      Sound.removePlayBackListener();
      Sound.stopPlayer().catch(() => undefined);
      Sound.stopRecorder().catch(() => undefined);
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
      }
      if (otherTypingTimerRef.current) {
        clearTimeout(otherTypingTimerRef.current);
      }
      if (typingActiveRef.current) {
        chatSocket.sendTypingStop(otherUserId);
        typingActiveRef.current = false;
      }
    };
  }, [otherUserId]);

  const scrollToLatestMessage = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: hasLoadedRef.current });
      shouldScrollToEndRef.current = false;
    });
  }, []);

  const decryptChatMessages = useCallback(
    (items: Message[]) =>
      decryptMessagesForDisplay(items, user?.id, e2eeState.localKey),
    [e2eeState.localKey, user?.id],
  );

  const decryptIncomingMessage = useCallback(
    async (message: Message) => {
      if (!user?.id || !e2eeState.localKey) {
        const [fallback] = await decryptMessagesForDisplay(
          [message],
          user?.id,
          e2eeState.localKey,
        );
        return fallback || message;
      }

      return decryptMessageForDisplay(message, user.id, e2eeState.localKey);
    },
    [e2eeState.localKey, user?.id],
  );

  const encryptContentForRecipient = useCallback(
    async (
      content: string,
      recipientId: number,
      recipientPublicKey?: string,
    ): Promise<EncryptedMessagePayload | undefined> => {
      if (!content) {
        return undefined;
      }
      if (!user?.id || !e2eeState.localKey || !e2eeState.selfEnabled) {
        return undefined;
      }

      let publicKey = recipientPublicKey;
      if (!publicKey) {
        const status = await e2eeApi.getStatus(recipientId);
        if (!status.enabled || !status.public_key) {
          throw new Error('Recipient E2EE is not enabled');
        }
        publicKey = status.public_key;
      }

      return encryptMessage({
        plaintext: content,
        senderUserId: user.id,
        recipientUserId: recipientId,
        senderBundle: e2eeState.localKey,
        recipientPublicKeyBase64: publicKey,
      });
    },
    [e2eeState.localKey, e2eeState.selfEnabled, user?.id],
  );

  const encryptCurrentChatContent = useCallback(
    async (content: string) => {
      if (!content) {
        return undefined;
      }
      if (e2eeState.loading || (e2eeState.selfEnabled && !e2eeReady)) {
        throw new Error('E2EE is not ready for this conversation');
      }
      if (!e2eeReady) {
        return undefined;
      }

      return encryptContentForRecipient(
        content,
        otherUserId,
        e2eeState.recipientPublicKey,
      );
    },
    [
      e2eeReady,
      e2eeState.loading,
      e2eeState.recipientPublicKey,
      e2eeState.selfEnabled,
      encryptContentForRecipient,
      otherUserId,
    ],
  );

  const recipientPublicKeyForUser = useCallback(
    async (recipientId: number) => {
      if (recipientId === otherUserId && e2eeState.recipientPublicKey) {
        return e2eeState.recipientPublicKey;
      }

      const status = await e2eeApi.getStatus(recipientId);
      if (!status.enabled || !status.public_key) {
        throw new Error('Recipient E2EE is not enabled');
      }
      return status.public_key;
    },
    [e2eeState.recipientPublicKey, otherUserId],
  );

  const encryptAndUploadAttachment = useCallback(
    async (
      source: LocalAttachmentSource,
      fileType: AttachmentFileType,
      recipientId: number,
    ): Promise<MessageAttachment> => {
      if (!user?.id || !e2eeState.localKey) {
        throw new Error('E2EE is not ready for this conversation');
      }

      const recipientPublicKey = await recipientPublicKeyForUser(recipientId);
      const encrypted = await encryptAttachmentForUpload({
        source,
        fileType,
        senderUserId: user.id,
        recipientUserId: recipientId,
        senderBundle: e2eeState.localKey,
        recipientPublicKeyBase64: recipientPublicKey,
      });
      const uploadFile: UploadFilePart = {
        uri: encrypted.encryptedUri,
        type: 'application/octet-stream',
        fileName: encrypted.encryptedFileName,
        fileSize: encrypted.encryptedSize,
      };

      if (fileType === 'voice') {
        const attachment = await messageApi.uploadVoice(
          {
            ...uploadFile,
            durationSeconds: source.durationSeconds || 0,
          },
          encrypted.fields,
        );
        return withDecryptedAttachmentPreview(
          attachment,
          encrypted.previewUri,
          encrypted.metadata,
          encrypted.fields,
        );
      }

      if (fileType === 'video_note') {
        const attachment = await messageApi.uploadVideoNote(
          {
            ...uploadFile,
            durationSeconds: source.durationSeconds || 0,
          },
          encrypted.fields,
        );
        return withDecryptedAttachmentPreview(
          attachment,
          encrypted.previewUri,
          encrypted.metadata,
          encrypted.fields,
        );
      }

      const attachment = await messageApi.uploadImage(uploadFile, {
        ...encrypted.fields,
        width: encrypted.metadata.width,
        height: encrypted.metadata.height,
      });
      return withDecryptedAttachmentPreview(
        attachment,
        encrypted.previewUri,
        encrypted.metadata,
        encrypted.fields,
      );
    },
    [e2eeState.localKey, recipientPublicKeyForUser, user?.id],
  );

  const uploadForwardedAttachments = useCallback(
    async (attachments: MessageAttachment[], recipientId: number) => {
      const uploaded: MessageAttachment[] = [];
      for (const attachment of attachments) {
        const source = await localSourceFromAttachment(attachment);
        uploaded.push(
          await encryptAndUploadAttachment(
            source,
            attachment.file_type,
            recipientId,
          ),
        );
      }
      return uploaded;
    },
    [encryptAndUploadAttachment],
  );

  useEffect(() => {
    let cancelled = false;
    setE2eeState(previous => ({ ...previous, loading: true }));

    if (!user?.id) {
      setE2eeState({
        loading: false,
        selfEnabled: false,
        recipientEnabled: false,
        recipientPublicKey: '',
        localKey: null,
      });
      return () => {
        cancelled = true;
      };
    }

    Promise.all([
      e2eeApi.getStatus(),
      e2eeApi.getStatus(otherUserId),
      getLocalE2EEKeyBundle(user.id),
    ])
      .then(([selfStatus, recipientStatus, localKey]) => {
        if (cancelled) {
          return;
        }
        setE2eeState({
          loading: false,
          selfEnabled: selfStatus.enabled,
          recipientEnabled: recipientStatus.enabled,
          recipientPublicKey: recipientStatus.public_key || '',
          localKey,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setE2eeState(previous => ({
          ...previous,
          loading: false,
          recipientEnabled: false,
          recipientPublicKey: '',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [otherUserId, user?.id]);

  useEffect(() => {
    const unsubscribe = addLocalE2EEKeyChangeListener(() => {
      if (!user?.id) {
        return;
      }

      getLocalE2EEKeyBundle(user.id)
        .then(localKey => {
          setE2eeState(previous => ({ ...previous, localKey }));
        })
        .catch(() => undefined);
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id]);

  const markConversationRead = useCallback(async () => {
    await messageApi.markAsRead(otherUserId);
    refreshUnreadCount().catch(() => undefined);
    signalChatDataChanged();
    setMessages(previous =>
      previous.map(message =>
        message.from_id === otherUserId && message.to_id === user?.id
          ? {
              ...message,
              is_read: true,
            }
          : message,
      ),
    );
  }, [otherUserId, refreshUnreadCount, signalChatDataChanged, user?.id]);

  const loadMessages = useCallback(
    async (mode: LoadMode = 'initial') => {
      const showInitialLoading = mode === 'initial' && !hasLoadedRef.current;

      if (showInitialLoading) {
        setLoading(true);
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }

      setError(null);
      try {
        const response = await messageApi.getMessagesWith(otherUserId, {
          limit: messagePageSize,
        });
        shouldScrollToEndRef.current =
          mode !== 'silent' || messagesRef.current.length === 0;
        hasMoreRef.current = response.has_more;
        setHasMore(response.has_more);
        setMessages(await decryptChatMessages(response.messages));
        markConversationRead().catch(() => undefined);
      } catch (apiError) {
        setError(getApiErrorMessage(apiError));
      } finally {
        hasLoadedRef.current = true;
        setHasLoaded(true);
        if (showInitialLoading) {
          setLoading(false);
        }
        if (mode === 'refresh') {
          setRefreshing(false);
        }
      }
    },
    [decryptChatMessages, markConversationRead, otherUserId],
  );

  const loadOlderMessages = useCallback(async () => {
    const currentMessages = messagesRef.current;
    const oldestMessage = currentMessages[0];

    if (
      loadingOlderRef.current ||
      !hasMoreRef.current ||
      !oldestMessage ||
      refreshing
    ) {
      return;
    }

    loadingOlderRef.current = true;
    shouldScrollToEndRef.current = false;
    setLoadingOlder(true);

    try {
      const response = await messageApi.getMessagesWith(otherUserId, {
        before: oldestMessage.id,
        limit: messagePageSize,
      });
      hasMoreRef.current = response.has_more;
      setHasMore(response.has_more);

      if (response.messages.length) {
        const displayMessages = await decryptChatMessages(response.messages);
        setMessages(previous => {
          const existingIds = new Set(previous.map(message => message.id));
          const olderMessages = displayMessages.filter(
            message => !existingIds.has(message.id),
          );

          return olderMessages.length
            ? [...olderMessages, ...previous]
            : previous;
        });
      }
    } catch (apiError) {
      setError(chatErrorMessage(apiError));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [decryptChatMessages, otherUserId, refreshing]);

  const handleMessagesScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (event.nativeEvent.contentOffset.y > loadOlderThreshold) {
        return;
      }

      loadOlderMessages().catch(() => undefined);
    },
    [loadOlderMessages],
  );

  const handleMessageListContentSizeChange = useCallback(() => {
    if (shouldScrollToEndRef.current) {
      scrollToLatestMessage();
    }
  }, [scrollToLatestMessage]);

  const loadPinnedMessage = useCallback(async () => {
    try {
      const pin = await messageApi.getPinnedMessage(otherUserId);
      setPinnedMessage(
        pin?.message
          ? {
              ...pin,
              message: await decryptIncomingMessage(pin.message),
            }
          : pin,
      );
    } catch {
      setPinnedMessage(null);
    }
  }, [decryptIncomingMessage, otherUserId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages().catch(() => undefined);
      loadPinnedMessage().catch(() => undefined);
    }, [loadMessages, loadPinnedMessage]),
  );

  useEffect(() => {
    if (isFocused && isForeground) {
      chatSocket.setActiveConversation(otherUserId);
      return () => {
        chatSocket.clearActiveConversation();
      };
    }

    chatSocket.clearActiveConversation();
    return undefined;
  }, [isFocused, isForeground, otherUserId]);

  useEffect(() => {
    const unsubscribe = chatSocket.onStatus(connected => {
      if (connected && isFocused && isForeground) {
        chatSocket.setActiveConversation(otherUserId);
      }
    });

    return unsubscribe;
  }, [isFocused, isForeground, otherUserId]);

  useAppResumeEffect(() => {
    if (!isFocused) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
    loadPinnedMessage().catch(() => undefined);
  });

  useEffect(() => {
    const wasNetworkConnected = previousNetworkConnectedRef.current;
    previousNetworkConnectedRef.current = networkConnected;

    if (!isFocused || !networkConnected || wasNetworkConnected) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
    loadPinnedMessage().catch(() => undefined);
  }, [isFocused, loadMessages, loadPinnedMessage, networkConnected]);

  const restoreDraftAfterSendError = useCallback(() => {
    if (!draftRef.current) {
      return;
    }

    setInput(draftRef.current.input);
    setInputHeight(estimateComposerInputHeight(draftRef.current.input));
    setPendingImages(draftRef.current.pendingImages);
    draftRef.current = null;
  }, []);

  const handleSocketEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === WS_EVENTS.MESSAGE_ERROR) {
        const payload = event.payload as { error: string };
        restoreDraftAfterSendError();
        setError(getApiErrorMessage(new Error(payload.error)));
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_READ) {
        const payload = event.payload as { from_id: number; to_id: number };
        refreshUnreadCount().catch(() => undefined);
        setMessages(previous =>
          previous.map(message =>
            message.from_id === payload.to_id &&
            message.to_id === payload.from_id
              ? {
                  ...message,
                  is_read: true,
                }
              : message,
          ),
        );
        return;
      }

      if (event.type === WS_EVENTS.CONVERSATION_READ) {
        const payload = event.payload as {
          reader_id?: number;
          conversation_id?: number;
        };
        if (
          payload.reader_id === user?.id &&
          payload.conversation_id === otherUserId
        ) {
          refreshUnreadCount().catch(() => undefined);
          signalChatDataChanged();
        }
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_DELETE) {
        const payload = event.payload as { message_id: number };

        if (!messagesRef.current.some(item => item.id === payload.message_id)) {
          return;
        }

        setMessages(previous =>
          previous.filter(item => item.id !== payload.message_id),
        );
        signalChatDataChanged();
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_UPDATE) {
        const message = event.payload as Message;
        const belongsToChat =
          (message.from_id === otherUserId && message.to_id === user?.id) ||
          (message.to_id === otherUserId && message.from_id === user?.id);
        const existingMessage = messagesRef.current.find(
          item => item.id === message.id,
        );

        if (
          !belongsToChat ||
          !existingMessage ||
          !shouldApplyMessageUpdate(existingMessage, message)
        ) {
          return;
        }

        decryptIncomingMessage(message)
          .then(displayMessage => {
            setMessages(previous =>
              previous.map(item =>
                item.id === message.id &&
                shouldApplyMessageUpdate(item, displayMessage)
                  ? displayMessage
                  : item,
              ),
            );
            signalChatDataChanged();
          })
          .catch(() => undefined);
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_PINNED) {
        const payload = event.payload as {
          conversation_user_id?: number;
          pinned_message?: PinnedMessage | null;
        };
        if (
          !payload.conversation_user_id ||
          payload.conversation_user_id === otherUserId
        ) {
          if (payload.pinned_message?.message) {
            decryptIncomingMessage(payload.pinned_message.message)
              .then(displayMessage => {
                setPinnedMessage({
                  ...payload.pinned_message!,
                  message: displayMessage,
                });
              })
              .catch(() => undefined);
          } else {
            setPinnedMessage(payload.pinned_message ?? null);
          }
        }
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_UNPINNED) {
        const payload = event.payload as { conversation_user_id?: number };
        if (
          !payload.conversation_user_id ||
          payload.conversation_user_id === otherUserId
        ) {
          setPinnedMessage(null);
        }
        return;
      }

      if (
        event.type === WS_EVENTS.TYPING_START ||
        event.type === WS_EVENTS.TYPING_STOP
      ) {
        const payload = event.payload as { from_id?: number };
        if (payload.from_id !== otherUserId) {
          return;
        }

        if (event.type === WS_EVENTS.TYPING_START) {
          setOtherTyping(true);
          if (otherTypingTimerRef.current) {
            clearTimeout(otherTypingTimerRef.current);
          }
          otherTypingTimerRef.current = setTimeout(() => {
            setOtherTyping(false);
            otherTypingTimerRef.current = null;
          }, 2200);
          return;
        }

        if (otherTypingTimerRef.current) {
          clearTimeout(otherTypingTimerRef.current);
          otherTypingTimerRef.current = null;
        }
        setOtherTyping(false);
        return;
      }

      if (event.type !== WS_EVENTS.MESSAGE_NEW) {
        return;
      }

      const message = event.payload as Message;
      const belongsToChat =
        (message.from_id === otherUserId && message.to_id === user?.id) ||
        (message.to_id === otherUserId && message.from_id === user?.id);

      if (!belongsToChat) {
        return;
      }

      if (message.from_id === user?.id && message.to_id === otherUserId) {
        draftRef.current = null;
      }

      decryptIncomingMessage(message)
        .then(displayMessage => {
          setMessages(previous => {
            if (previous.some(item => item.id === displayMessage.id)) {
              return previous;
            }
            shouldScrollToEndRef.current = true;
            return [...previous, displayMessage];
          });

          if (message.from_id === otherUserId) {
            markConversationRead().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    },
    [
      decryptIncomingMessage,
      markConversationRead,
      otherUserId,
      refreshUnreadCount,
      restoreDraftAfterSendError,
      signalChatDataChanged,
      user?.id,
    ],
  );

  useEffect(() => {
    const unsubscribeMessages = chatSocket.onMessage(handleSocketEvent);
    chatSocket.connect();

    return () => {
      unsubscribeMessages();
    };
  }, [handleSocketEvent]);

  async function pickImages() {
    const remaining = CHAT_IMAGE_MAX_COUNT - pendingImages.length;
    if (remaining <= 0) {
      setError(
        `Можно прикрепить не больше ${CHAT_IMAGE_MAX_COUNT} изображений`,
      );
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: remaining,
      restrictMimeTypes: [...CHAT_IMAGE_MIME_TYPES],
      includeExtra: true,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.8,
    });

    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError('Не удалось выбрать изображение. Попробуйте еще раз.');
      return;
    }

    const images = (result.assets || [])
      .map(assetToLocalImage)
      .filter((image): image is LocalChatImage => Boolean(image));
    const firstError = images.map(validateLocalChatImage).find(Boolean);

    if (firstError) {
      setError(firstError);
      return;
    }

    setError(null);
    setPendingImages(previous =>
      [...previous, ...images].slice(0, CHAT_IMAGE_MAX_COUNT),
    );
  }

  async function ensureRecordAudioPermission() {
    if (Platform.OS !== 'android') {
      return true;
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Доступ к микрофону',
        message:
          'Разрешите доступ к микрофону, чтобы записывать голосовые сообщения.',
        buttonNegative: 'Отмена',
        buttonPositive: 'Разрешить',
      },
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function ensureVideoNotePermissions() {
    if (Platform.OS !== 'android') {
      return true;
    }

    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);

    return (
      results[PermissionsAndroid.PERMISSIONS.CAMERA] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  }

  function clearRecordingLimitTimer() {
    if (recordingMaxTimerRef.current) {
      clearTimeout(recordingMaxTimerRef.current);
      recordingMaxTimerRef.current = null;
    }
  }

  async function startVoiceRecording() {
    if (
      recordingActiveRef.current ||
      recordingBusyRef.current ||
      sendingRef.current ||
      editingMessageRef.current
    ) {
      return;
    }
    if (previewPlayingRef.current) {
      Sound.stopPlayer().catch(() => undefined);
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      setPreviewPlaying(false);
      previewPlayingRef.current = false;
    }
    if (pendingImagesRef.current.length > 0) {
      setError('Сначала отправьте или удалите выбранные изображения');
      return;
    }

    recordingBusyRef.current = true;
    setRecordingBusy(true);
    setError(null);

    try {
      const permitted = await ensureRecordAudioPermission();
      if (!permitted) {
        setError(
          'Разрешите доступ к микрофону, чтобы записать голосовое сообщение',
        );
        return;
      }

      Sound.setSubscriptionDuration(0.25);
      Sound.removeRecordBackListener();
      Sound.addRecordBackListener(event => {
        const seconds = Math.max(
          0,
          Math.floor((event.currentPosition || event.recordSecs || 0) / 1000),
        );
        recordingSecondsRef.current = seconds;
        setRecordingSeconds(seconds);
      });

      await Sound.startRecorder(undefined, voiceAudioSet, false);
      recordingStartedAtRef.current = Date.now();
      recordingSecondsRef.current = 0;
      recordingActiveRef.current = true;
      setRecordingSeconds(0);
      setRecording(true);
      recordingMaxTimerRef.current = setTimeout(() => {
        Promise.resolve(
          (stopVoiceRecordingRef.current || stopVoiceRecording)(true),
        ).catch(() => undefined);
      }, CHAT_VOICE_MAX_DURATION_SECONDS * 1000);
    } catch (apiError) {
      Sound.removeRecordBackListener();
      setError(getApiErrorMessage(apiError));
    } finally {
      recordingBusyRef.current = false;
      setRecordingBusy(false);
    }
  }

  async function stopVoiceRecording(commitToPreview: boolean) {
    if (!recordingActiveRef.current || recordingBusyRef.current) {
      return;
    }

    recordingBusyRef.current = true;
    setRecordingBusy(true);
    clearRecordingLimitTimer();
    Sound.removeRecordBackListener();

    let path = '';
    try {
      path = await Sound.stopRecorder();
    } catch (apiError) {
      if (commitToPreview) {
        setError(getApiErrorMessage(apiError));
      }
    }

    const fallbackSeconds = Math.ceil(
      (Date.now() - recordingStartedAtRef.current) / 1000,
    );
    const durationSeconds = Math.max(
      0,
      recordingSecondsRef.current || fallbackSeconds,
    );

    recordingActiveRef.current = false;
    recordingStartedAtRef.current = 0;
    recordingSecondsRef.current = 0;
    recordingBusyRef.current = false;
    setRecording(false);
    setRecordingSeconds(0);
    setRecordingBusy(false);

    if (!commitToPreview) {
      return;
    }

    if (durationSeconds < 1 || !path) {
      setError('Голосовое сообщение слишком короткое');
      return;
    }

    // Commit to local preview card (no auto upload/send)
    const voice: LocalVoiceMessage = {
      uri: path,
      type: CHAT_VOICE_MIME_TYPE,
      fileName: `voice-message-${Date.now()}.webm`,
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
    };
    setPendingVoice(voice);
    setPreviewPosition(0);
    setPreviewPlaying(false);
    previewPlayingRef.current = false;
  }

  startVoiceRecordingRef.current = startVoiceRecording;
  stopVoiceRecordingRef.current = stopVoiceRecording;

  // sendVoiceMessage now used for explicit "Отправить" from preview card.
  // It reads current `input` as optional text comment (voice + text support).
  // Returns true on success.
  async function sendVoiceMessage(voice: LocalVoiceMessage): Promise<boolean> {
    const normalizedUri =
      voice.uri.startsWith('file://') || voice.uri.startsWith('content://')
        ? voice.uri
        : `file://${voice.uri}`;
    const voiceToSend: LocalVoiceMessage = { ...voice, uri: normalizedUri };

    const validationError = validateLocalVoiceMessage(voiceToSend);
    if (validationError) {
      setError(validationError);
      return false;
    }

    const comment = input.trim();

    setSending('uploadingVoice');
    setUploadProgress(null);
    setError(null);

    try {
      const commentEncryption = await encryptCurrentChatContent(comment);
      if (e2eeState.loading || (e2eeState.selfEnabled && !e2eeReady)) {
        throw new Error('E2EE is not ready for this conversation');
      }
      const attachment = e2eeReady
        ? await encryptAndUploadAttachment(voiceToSend, 'voice', otherUserId)
        : await messageApi.uploadVoice(voiceToSend);
      const attachments = [attachment];

      setSending('sending');
      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(
          otherUserId,
          commentEncryption ? '' : comment,
          attachments,
          replyToMessageRef.current?.id ?? null,
          commentEncryption,
        );
      } else {
        const sent = await messageApi.sendMessage(
          otherUserId,
          commentEncryption ? '' : comment,
          attachments,
          replyToMessageRef.current?.id ?? null,
          commentEncryption,
        );
        const displayMessage = await decryptIncomingMessage(sent);
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }
      if (comment) {
        setInput('');
        setInputHeight(composerInputMinHeight);
        stopLocalTyping();
      }
      setReplyToMessage(null);
      return true;
    } catch (apiError) {
      setError(chatErrorMessage(apiError));
      return false;
    } finally {
      setSending(null);
      setUploadProgress(null);
    }
  }

  // Preview voice (local, pre-send) playback using Sound (reuses same engine as sent voices)
  async function togglePreviewPlayback() {
    if (!pendingVoice) return;
    const raw = pendingVoice.uri;
    const uri =
      raw.startsWith('file://') || raw.startsWith('content://')
        ? raw
        : `file://${raw}`;

    try {
      if (previewPlayingRef.current) {
        await Sound.stopPlayer().catch(() => undefined);
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
        setPreviewPlaying(false);
        previewPlayingRef.current = false;
        setPreviewPosition(0);
        return;
      }

      // Stop any sent voice playback to avoid conflict
      if (playingVoiceUrlRef.current) {
        await Sound.stopPlayer().catch(() => undefined);
        setPlayingVoiceUrl(null);
      }

      Sound.removePlaybackEndListener();
      Sound.removePlayBackListener();

      Sound.addPlaybackEndListener(() => {
        Sound.removePlaybackEndListener();
        Sound.removePlayBackListener();
        setPreviewPlaying(false);
        previewPlayingRef.current = false;
        setPreviewPosition(pendingVoice.durationSeconds || 0);
      });

      Sound.addPlayBackListener(
        (meta: { currentPosition?: number; duration?: number }) => {
          if (typeof meta.currentPosition === 'number') {
            const sec = Math.max(0, meta.currentPosition / 1000);
            setPreviewPosition(sec);
          }
        },
      );

      await Sound.startPlayer(uri);
      setPreviewPlaying(true);
      previewPlayingRef.current = true;
    } catch (apiError) {
      Sound.removePlaybackEndListener();
      Sound.removePlayBackListener();
      setPreviewPlaying(false);
      previewPlayingRef.current = false;
      setError(getApiErrorMessage(apiError));
    }
  }

  async function deletePendingVoice() {
    if (previewPlayingRef.current) {
      await Sound.stopPlayer().catch(() => undefined);
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
    }
    setPreviewPlaying(false);
    previewPlayingRef.current = false;
    setPreviewPosition(0);
    setPendingVoice(null);
  }

  async function sendPendingVoice() {
    if (!pendingVoice) return;
    if (previewPlayingRef.current) {
      await Sound.stopPlayer().catch(() => undefined);
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
    }
    setPreviewPlaying(false);
    previewPlayingRef.current = false;
    const voiceToSend = pendingVoice;
    setPreviewPosition(0);
    setPendingVoice(null); // optimistic clear; restore on failure below
    const ok = await sendVoiceMessage(voiceToSend);
    if (!ok) {
      // restore preview so user can retry send/delete
      setPendingVoice(voiceToSend);
    }
  }

  async function recordVideoNote() {
    if (
      sendingRef.current ||
      editingMessageRef.current ||
      recordingActiveRef.current ||
      pendingImagesRef.current.length > 0 ||
      pendingVoice ||
      pendingVideoNote
    ) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }

    setError(null);
    const permitted = await ensureVideoNotePermissions();
    if (!permitted) {
      setError(
        'Разрешите доступ к камере и микрофону, чтобы записать видео-сообщение',
      );
      return;
    }

    const result = await launchCamera({
      mediaType: 'video',
      durationLimit: CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
      videoQuality: 'low',
      saveToPhotos: false,
    });

    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError('Не удалось записать видео-сообщение. Попробуйте еще раз.');
      return;
    }

    const videoNote = assetToLocalVideoNote(result.assets?.[0]);
    if (!videoNote) {
      setError('Не удалось подготовить видео-сообщение.');
      return;
    }

    const validationError = validateLocalVideoNoteMessage(videoNote);
    if (validationError) {
      setError(validationError);
      return;
    }

    setPendingVideoNote(videoNote);
  }

  async function sendVideoNoteMessage(videoNote: LocalVideoNoteMessage) {
    const normalizedUri =
      videoNote.uri.startsWith('file://') ||
      videoNote.uri.startsWith('content://')
        ? videoNote.uri
        : `file://${videoNote.uri}`;
    const videoNoteToSend = { ...videoNote, uri: normalizedUri };
    const validationError = validateLocalVideoNoteMessage(videoNoteToSend);
    if (validationError) {
      setError(validationError);
      return false;
    }

    const comment = input.trim();
    setSending('uploadingVideoNote');
    setUploadProgress(null);
    setError(null);

    try {
      const commentEncryption = await encryptCurrentChatContent(comment);
      if (e2eeState.loading || (e2eeState.selfEnabled && !e2eeReady)) {
        throw new Error('E2EE is not ready for this conversation');
      }
      const attachment = e2eeReady
        ? await encryptAndUploadAttachment(
            videoNoteToSend,
            'video_note',
            otherUserId,
          )
        : await messageApi.uploadVideoNote(videoNoteToSend);
      const attachments = [attachment];

      setSending('sending');
      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(
          otherUserId,
          commentEncryption ? '' : comment,
          attachments,
          replyToMessageRef.current?.id ?? null,
          commentEncryption,
        );
      } else {
        const sent = await messageApi.sendMessage(
          otherUserId,
          commentEncryption ? '' : comment,
          attachments,
          replyToMessageRef.current?.id ?? null,
          commentEncryption,
        );
        const displayMessage = await decryptIncomingMessage(sent);
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }

      if (comment) {
        setInput('');
        setInputHeight(composerInputMinHeight);
        stopLocalTyping();
      }
      setReplyToMessage(null);
      return true;
    } catch (apiError) {
      setError(chatErrorMessage(apiError));
      return false;
    } finally {
      setSending(null);
      setUploadProgress(null);
    }
  }

  async function sendPendingVideoNote() {
    if (!pendingVideoNote) {
      return;
    }
    const videoNote = pendingVideoNote;
    setPendingVideoNote(null);
    const ok = await sendVideoNoteMessage(videoNote);
    if (!ok) {
      setPendingVideoNote(videoNote);
    }
  }

  async function seekPreview(percent: number) {
    if (!pendingVoice) return;
    const dur = pendingVoice.durationSeconds || 0;
    if (dur <= 0) return;
    const targetSec = Math.max(0, Math.min(dur, percent * dur));
    setPreviewPosition(targetSec);

    try {
      if (previewPlayingRef.current) {
        await Sound.seekToPlayer(targetSec * 1000).catch(() => undefined);
      } else {
        // start then seek shortly after
        await togglePreviewPlayback();
        setTimeout(() => {
          Sound.seekToPlayer(targetSec * 1000).catch(() => undefined);
        }, 120);
      }
    } catch {
      // ignore seek errors
    }
  }

  async function handlePreviewProgressPress(e: GestureResponderEvent) {
    const bar = previewProgressBarRef.current;
    if (!bar || !pendingVoice) return;
    bar.measure((x, y, width, height, pageX) => {
      const relX = (e.nativeEvent as any).pageX - pageX;
      const pct = width > 0 ? Math.max(0, Math.min(1, relX / width)) : 0;
      seekPreview(pct).catch(() => undefined);
    });
  }

  async function sendMessage() {
    const trimmed = input.trim();

    if (editingMessage) {
      if (!trimmed) {
        setError('Введите текст сообщения');
        return;
      }

      setSending('sending');
      setError(null);
      try {
        const shouldEncryptEdit = Boolean(
          (editingMessage.encryption_version ?? 0) > 0 || e2eeState.selfEnabled,
        );
        if (shouldEncryptEdit) {
          if (editingMessage.decryption_error) {
            setError(
              'Нельзя редактировать сообщение, которое не удалось расшифровать',
            );
            return;
          }
          if (e2eeState.selfEnabled && !e2eeReady) {
            setError(
              'Сквозное шифрование недоступно для редактирования сообщения',
            );
            return;
          }

          const recipientId =
            editingMessage.to_id === user?.id
              ? editingMessage.from_id
              : editingMessage.to_id;
          const recipientPublicKey =
            recipientId === otherUserId
              ? e2eeState.recipientPublicKey
              : undefined;
          const encryption = await encryptContentForRecipient(
            trimmed,
            recipientId,
            recipientPublicKey,
          );
          if (!encryption) {
            setError(
              'Сквозное шифрование недоступно для редактирования сообщения',
            );
            return;
          }

          const updated = await messageApi.updateMessage(
            editingMessage.id,
            '',
            encryption,
          );
          const displayMessage = await decryptIncomingMessage(updated);
          setMessages(previous =>
            previous.map(message =>
              message.id === editingMessage.id &&
              shouldApplyMessageUpdate(message, displayMessage)
                ? displayMessage
                : message,
            ),
          );
          setInput('');
          setInputHeight(composerInputMinHeight);
          setEditingMessage(null);
          stopLocalTyping();
          signalChatDataChanged();
          return;
        }

        const updated = await messageApi.updateMessage(
          editingMessage.id,
          trimmed,
        );
        const displayMessage = await decryptIncomingMessage(updated);
        setMessages(previous =>
          previous.map(message =>
            message.id === editingMessage.id &&
            shouldApplyMessageUpdate(message, displayMessage)
              ? displayMessage
              : message,
          ),
        );
        setInput('');
        setInputHeight(composerInputMinHeight);
        setEditingMessage(null);
        stopLocalTyping();
        signalChatDataChanged();
      } catch (apiError) {
        setError(chatErrorMessage(apiError));
      } finally {
        setSending(null);
      }
      return;
    }

    if (!trimmed && pendingImages.length === 0) {
      setError('Введите сообщение или выберите изображение');
      return;
    }

    let uploadFailed = false;
    setSending(pendingImages.length > 0 ? 'uploading' : 'sending');
    setUploadProgress(
      pendingImages.length > 0
        ? {
            current: 0,
            total: pendingImages.length,
          }
        : null,
    );
    setError(null);
    try {
      const contentEncryption = await encryptCurrentChatContent(trimmed);
      if (e2eeState.selfEnabled && !e2eeReady) {
        throw new Error('E2EE is not ready for this conversation');
      }

      const attachments: MessageAttachment[] = [];
      for (const [index, image] of pendingImages.entries()) {
        try {
          attachments.push(
            e2eeReady
              ? await encryptAndUploadAttachment(image, 'image', otherUserId)
              : await messageApi.uploadImage(image),
          );
          setUploadProgress({
            current: index + 1,
            total: pendingImages.length,
          });
        } catch (apiError) {
          uploadFailed = true;
          throw apiError;
        }
      }

      setSending('sending');
      setUploadProgress(null);

      draftRef.current = {
        input,
        pendingImages,
      };

      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(
          otherUserId,
          contentEncryption ? '' : trimmed,
          attachments,
          replyToMessage?.id ?? null,
          contentEncryption,
        );
      } else {
        const sent = await messageApi.sendMessage(
          otherUserId,
          contentEncryption ? '' : trimmed,
          attachments,
          replyToMessage?.id ?? null,
          contentEncryption,
        );
        const displayMessage = await decryptIncomingMessage(sent);
        draftRef.current = null;
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }

      setInput('');
      setInputHeight(composerInputMinHeight);
      setPendingImages([]);
      setReplyToMessage(null);
      stopLocalTyping();
    } catch (apiError) {
      const message = chatErrorMessage(apiError);
      setError(
        uploadFailed
          ? `${message} Удалите изображение из предпросмотра или попробуйте отправить снова.`
          : message,
      );
    } finally {
      setSending(null);
      setUploadProgress(null);
    }
  }

  function removePendingImage(id: string) {
    setPendingImages(previous => previous.filter(image => image.id !== id));
  }

  function stopLocalTyping() {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }

    if (typingActiveRef.current) {
      chatSocket.sendTypingStop(otherUserId);
      typingActiveRef.current = false;
    }
  }

  function handleComposerTextChange(nextValue: string) {
    setInput(nextValue);

    if (!nextValue) {
      setInputHeight(composerInputMinHeight);
    }

    if (editingMessageRef.current || !isFocused) {
      return;
    }

    if (!nextValue.trim()) {
      stopLocalTyping();
      return;
    }

    if (!typingActiveRef.current) {
      chatSocket.sendTypingStart(otherUserId);
      typingActiveRef.current = true;
    }

    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }

    typingStopTimerRef.current = setTimeout(() => {
      chatSocket.sendTypingStop(otherUserId);
      typingActiveRef.current = false;
      typingStopTimerRef.current = null;
    }, 1400);
  }

  function handleComposerContentSizeChange(contentHeight: number) {
    const nextHeight = Math.min(
      composerInputMaxHeight,
      Math.max(composerInputMinHeight, Math.ceil(contentHeight) + 16),
    );
    setInputHeight(nextHeight);
  }

  function copyValue(value: string, notice: string) {
    Clipboard.setString(value);
    setSelectedMessage(null);
    setCopyNotice(notice);
  }

  async function toggleVoicePlayback(url: string) {
    try {
      // Stop preview if active (mutual exclusive)
      if (previewPlayingRef.current) {
        await Sound.stopPlayer().catch(() => undefined);
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
        setPreviewPlaying(false);
        previewPlayingRef.current = false;
        setPreviewPosition(0);
      }

      if (playingVoiceUrlRef.current === url) {
        await Sound.stopPlayer();
        Sound.removePlaybackEndListener();
        setPlayingVoiceUrl(null);
        return;
      }

      if (playingVoiceUrlRef.current) {
        await Sound.stopPlayer().catch(() => undefined);
      }

      Sound.removePlaybackEndListener();
      Sound.addPlaybackEndListener(() => {
        Sound.removePlaybackEndListener();
        setPlayingVoiceUrl(null);
      });

      const cookieHeader = await getCookieHeader();
      const headers = cookieHeader ? { Cookie: cookieHeader } : undefined;
      await Sound.startPlayer(url, headers);
      setPlayingVoiceUrl(url);
    } catch (apiError) {
      Sound.removePlaybackEndListener();
      setPlayingVoiceUrl(null);
      setError(getApiErrorMessage(apiError));
    }
  }

  async function deleteSelectedMessage(message: Message) {
    setSelectedMessage(null);

    try {
      if (message.id > 0 && message.id < 10000000) {
        await messageApi.deleteMessage(message.id);
      }
      setMessages(previous => previous.filter(item => item.id !== message.id));
      signalChatDataChanged();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }

  function startEditingMessage(message: Message) {
    setSelectedMessage(null);
    setPendingImages([]);
    setReplyToMessage(null);
    stopLocalTyping();
    setEditingMessage(message);
    setInput(message.content);
    setInputHeight(estimateComposerInputHeight(message.content));
    setError(null);
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setInput('');
    setInputHeight(composerInputMinHeight);
    setError(null);
    stopLocalTyping();
  }

  function startReply(message: Message) {
    setSelectedMessage(null);
    setEditingMessage(null);
    setReplyToMessage(message);
    setError(null);
  }

  async function pinSelectedMessage(message: Message) {
    setSelectedMessage(null);
    try {
      const pin = await messageApi.pinMessage(otherUserId, message.id);
      setPinnedMessage(pin);
      setCopyNotice('Сообщение закреплено');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }

  async function unpinCurrentMessage() {
    try {
      await messageApi.unpinMessage(otherUserId);
      setPinnedMessage(null);
      setCopyNotice('Закреп снят');
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }

  async function openForwardDialog(message: Message) {
    setSelectedMessage(null);
    setForwardMessage(message);
    setForwardSelectedIds(new Set());
    setForwardError(null);
    setForwardLoading(true);
    try {
      const friends = await friendsApi.getFriendsList();
      setForwardFriends(friends.filter(friend => Boolean(friend.id)));
    } catch (apiError) {
      setForwardError(getApiErrorMessage(apiError));
    } finally {
      setForwardLoading(false);
    }
  }

  function toggleForwardRecipient(userId: number) {
    setForwardSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function submitForward() {
    if (!forwardMessage || forwardSelectedIds.size === 0) {
      setForwardError('Выберите хотя бы одного получателя');
      return;
    }

    setForwardLoading(true);
    setForwardError(null);
    try {
      const forwardAttachments = forwardMessage.attachments || [];
      const hasEncryptedAttachments = forwardAttachments.some(attachment =>
        isEncryptedAttachment(attachment),
      );
      const requiresClientEncryption =
        (forwardMessage.encryption_version ?? 0) > 0 || hasEncryptedAttachments;

      if (requiresClientEncryption) {
        const content = forwardMessage.content.trim();
        const encryptedContentRequired =
          (forwardMessage.encryption_version ?? 0) > 0;
        if (
          forwardMessage.decryption_error ||
          (encryptedContentRequired && !content)
        ) {
          setForwardError(
            'Нельзя переслать сообщение, которое не удалось расшифровать',
          );
          return;
        }
        if (
          forwardAttachments.some(attachment => attachment.decryption_error)
        ) {
          setForwardError(
            'Нельзя переслать вложение, которое не удалось расшифровать',
          );
          return;
        }

        const encryptedMessages = [];
        for (const recipientId of Array.from(forwardSelectedIds)) {
          const encryption = content
            ? await encryptContentForRecipient(content, recipientId)
            : undefined;
          if (encryptedContentRequired && !encryption) {
            throw new Error('E2EE is not ready for forward recipient');
          }
          const attachments = forwardAttachments.length
            ? await uploadForwardedAttachments(forwardAttachments, recipientId)
            : [];
          encryptedMessages.push({
            toUserId: recipientId,
            ...(encryption || {}),
            attachments,
          });
        }

        const forwardedRaw = await messageApi.forwardEncryptedMessage(
          forwardMessage.id,
          encryptedMessages,
        );
        const forwarded = await Promise.all(
          forwardedRaw.map(message => decryptIncomingMessage(message)),
        );
        const currentChatMessages = forwarded.filter(
          message =>
            (message.from_id === user?.id && message.to_id === otherUserId) ||
            (message.to_id === user?.id && message.from_id === otherUserId),
        );
        if (currentChatMessages.length) {
          shouldScrollToEndRef.current = true;
          setMessages(previous => [...previous, ...currentChatMessages]);
        }
        setForwardMessage(null);
        setForwardSelectedIds(new Set());
        setCopyNotice('Сообщение переслано');
        signalChatDataChanged();
        return;
      }

      const forwardedRaw = await messageApi.forwardMessage(
        forwardMessage.id,
        Array.from(forwardSelectedIds),
      );
      const forwarded = await Promise.all(
        forwardedRaw.map(message => decryptIncomingMessage(message)),
      );
      const currentChatMessages = forwarded.filter(
        message =>
          (message.from_id === user?.id && message.to_id === otherUserId) ||
          (message.to_id === user?.id && message.from_id === otherUserId),
      );
      if (currentChatMessages.length) {
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, ...currentChatMessages]);
      }
      setForwardMessage(null);
      setCopyNotice('Сообщение переслано');
      signalChatDataChanged();
    } catch (apiError) {
      setForwardError(
        apiError instanceof Error && apiError.message.includes('E2EE')
          ? 'Не удалось переслать сообщение. Проверьте, что у получателя включено E2EE.'
          : getApiErrorMessage(apiError),
      );
    } finally {
      setForwardLoading(false);
    }
  }

  function openMessageActions(message: Message) {
    setSelectedMessage(message);
  }

  return (
    <Screen
      scroll={false}
      padded={false}
      avoidKeyboard
      contentContainerStyle={styles.container}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={copyNotice} />

      <View style={styles.callActions}>
        <IconButton
          label="Аудиозвонок"
          variant="secondary"
          icon={Phone}
          disabled={callStatus !== 'idle'}
          onPress={() => startAudioCall(otherUserId, route.params.name)}
        />
        <IconButton
          label="Видеозвонок"
          variant="secondary"
          icon={VideoIcon}
          disabled={callStatus !== 'idle'}
          onPress={() => startVideoCall(otherUserId, route.params.name)}
        />
      </View>

      {e2eeReady ? (
        <View style={[styles.e2eeStatusBar, themed.surfaceBar]}>
          <Text style={[styles.e2eeStatusText, themed.accentText]}>
            E2EE включено для этого диалога
          </Text>
        </View>
      ) : e2eeState.selfEnabled && !e2eeState.loading ? (
        <View style={[styles.e2eeStatusBar, themed.dangerSoft]}>
          <Text style={[styles.e2eeStatusText, themed.dangerText]}>
            E2EE недоступно: восстановите ключ или проверьте ключ собеседника
          </Text>
        </View>
      ) : null}

      {pinnedMessage?.message ? (
        <Pressable
          accessibilityRole="button"
          style={[styles.pinnedBar, themed.card]}
          onPress={() => {
            const targetId = pinnedMessage.message_id;
            const index = messages.findIndex(
              message => message.id === targetId,
            );
            if (index >= 0) {
              listRef.current?.scrollToIndex({ index, animated: true });
            }
          }}
          onLongPress={unpinCurrentMessage}
        >
          <View style={[styles.pinnedStripe, themed.accentBg]} />
          <View style={styles.pinnedInfo}>
            <Text style={[styles.pinnedTitle, themed.accentText]}>
              Закрепленное сообщение
            </Text>
            <Text style={[styles.pinnedText, themed.text]} numberOfLines={1}>
              {messagePreviewText(pinnedMessage.message)}
            </Text>
          </View>
          <Text style={[styles.pinnedHint, themed.softText]}>удерж. снять</Text>
        </Pressable>
      ) : null}

      {loading && !hasLoaded ? (
        <View style={styles.loading}>
          <LoadingState text="Загружаем сообщения" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => String(item.id)}
          refreshing={refreshing}
          onRefresh={() => loadMessages('refresh')}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={handleMessagesScroll}
          scrollEventThrottle={80}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              outgoing={item.from_id === user?.id}
              onImagePress={setSelectedImageUrl}
              onVoicePress={url => toggleVoicePlayback(url)}
              playingVoiceUrl={playingVoiceUrl}
              onLongPress={() => openMessageActions(item)}
              themeColors={themeColors}
            />
          )}
          contentContainerStyle={[
            styles.messageList,
            messages.length === 0 && styles.emptyMessageList,
          ]}
          onContentSizeChange={handleMessageListContentSizeChange}
          ListHeaderComponent={
            loadingOlder ? (
              <View style={styles.loadingOlder}>
                <ActivityIndicator color={themeColors.accent} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="Сообщений пока нет"
              text="Напишите первым, отправьте изображение или голосовое."
            />
          }
        />
      )}

      {pendingImages.length > 0 ? (
        <View style={[styles.previewStrip, themed.surfaceBar]}>
          {pendingImages.map(image => (
            <View key={image.id} style={styles.previewItem}>
              <Image source={{ uri: image.uri }} style={styles.previewImage} />
              <Pressable
                accessibilityRole="button"
                style={styles.previewRemove}
                onPress={() => removePendingImage(image.id)}
              >
                <Text style={styles.previewRemoveText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {sending ? (
        <View style={[styles.sendStatus, themed.surfaceBar]}>
          <ActivityIndicator color={themeColors.accent} />
          <Text style={[styles.sendStatusText, themed.mutedText]}>
            {sending === 'uploadingVoice'
              ? 'Загружаем голосовое сообщение'
              : sending === 'uploadingVideoNote'
              ? 'Загружаем видео-сообщение'
              : sending === 'uploading'
              ? uploadProgress
                ? `Загружаем изображения: ${uploadProgress.current} из ${uploadProgress.total}`
                : 'Загружаем изображение'
              : 'Отправляем сообщение'}
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
            onPress={cancelEditingMessage}
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
            onPress={() => setReplyToMessage(null)}
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
            onPress={() => {
              stopVoiceRecording(false).catch(() => undefined);
            }}
          >
            <Text style={styles.recordingCancelText}>Отмена</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.recordingSend}
            disabled={recordingBusy}
            onPress={() => {
              stopVoiceRecording(true).catch(() => undefined);
            }}
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
              onPress={() => setPendingVideoNote(null)}
              disabled={Boolean(sending)}
            />
            <IconButton
              icon={Send}
              label="Отправить видео-сообщение"
              variant="primary"
              size="sm"
              onPress={() => {
                sendPendingVideoNote().catch(() => undefined);
              }}
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
              onPress={() => {
                togglePreviewPlayback().catch(() => undefined);
              }}
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
              style={styles.previewProgressBar}
              onStartShouldSetResponder={() => true}
              onResponderRelease={handlePreviewProgressPress}
            >
              <View
                style={[
                  styles.previewProgressFill,
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
              onPress={() => {
                deletePendingVoice().catch(() => undefined);
              }}
              disabled={Boolean(sending)}
            />
            <IconButton
              icon={Send}
              label="Отправить голосовое сообщение"
              variant="primary"
              size="sm"
              onPress={() => {
                sendPendingVoice().catch(() => undefined);
              }}
              disabled={Boolean(sending)}
            />
          </View>
        </View>
      ) : null}

      {otherTyping ? (
        <View style={[styles.typingBar, themed.surfaceBar]}>
          <Text style={[styles.typingText, themed.mutedText]}>
            {route.params.name} печатает...
          </Text>
        </View>
      ) : null}

      <View style={[styles.composer, themed.surfaceBar]}>
        <View style={styles.composerTools}>
          <IconButton
            label="Прикрепить фото"
            variant="secondary"
            icon={ImagePlus}
            disabled={Boolean(sending) || Boolean(editingMessage) || recording}
            onPress={pickImages}
            style={styles.composerToolButton}
          />
          <IconButton
            label={recording ? 'Завершить запись' : 'Записать голосовое'}
            variant={recording ? 'danger' : 'secondary'}
            icon={Mic}
            disabled={
              Boolean(sending) ||
              Boolean(editingMessage) ||
              pendingImages.length > 0 ||
              recordingBusy ||
              Boolean(pendingVoice) ||
              Boolean(pendingVideoNote)
            }
            onPress={() => {
              if (recordingActiveRef.current) {
                stopVoiceRecording(true).catch(() => undefined);
                return;
              }
              startVoiceRecording().catch(() => undefined);
            }}
            style={[
              styles.composerToolButton,
              recording ? styles.voiceButtonRecording : undefined,
            ]}
          />
          <IconButton
            label="Записать видео-сообщение"
            variant="secondary"
            icon={VideoIcon}
            disabled={
              Boolean(sending) ||
              Boolean(editingMessage) ||
              pendingImages.length > 0 ||
              recording ||
              Boolean(pendingVoice) ||
              Boolean(pendingVideoNote)
            }
            onPress={() => {
              recordVideoNote().catch(() => undefined);
            }}
            style={styles.composerToolButton}
          />
        </View>
        <View style={styles.composerInputRow}>
          <TextInput
            value={input}
            onChangeText={handleComposerTextChange}
            onContentSizeChange={event =>
              handleComposerContentSizeChange(
                event.nativeEvent.contentSize.height,
              )
            }
            placeholder="Сообщение"
            placeholderTextColor={themeColors.soft}
            multiline
            scrollEnabled={inputHeight >= composerInputMaxHeight}
            maxLength={1000}
            editable={!sending && !recording}
            textAlignVertical="top"
            style={[styles.input, themed.input, { height: inputHeight }]}
          />
          <IconButton
            label={editingMessage ? 'Сохранить сообщение' : 'Отправить'}
            icon={editingMessage ? Pencil : Send}
            variant="primary"
            disabled={
              Boolean(sending) ||
              recording ||
              (!input.trim() &&
                !editingMessage &&
                pendingImages.length === 0 &&
                !pendingVoice &&
                !pendingVideoNote) ||
              Boolean(pendingVoice) ||
              Boolean(pendingVideoNote)
            }
            loading={Boolean(sending)}
            onPress={sendMessage}
            style={styles.composerSendButton}
          />
        </View>
      </View>

      <Modal
        visible={Boolean(selectedImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <Pressable
          style={styles.lightbox}
          onPress={() => setSelectedImageUrl(null)}
        >
          {selectedImageUrl ? (
            <Image
              source={{ uri: selectedImageUrl }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={styles.lightboxClose}
            onPress={() => setSelectedImageUrl(null)}
          >
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </Pressable>
      </Modal>

      <MessageActionSheet
        message={selectedMessage}
        onClose={() => setSelectedMessage(null)}
        onCopyText={message =>
          copyValue(message.content.trim(), 'Текст скопирован')
        }
        onCopyLink={url => copyValue(url, 'Ссылка скопирована')}
        onDelete={message => {
          deleteSelectedMessage(message).catch(() => undefined);
        }}
        onEdit={startEditingMessage}
        onReply={startReply}
        onForward={openForwardDialog}
        onPin={message => {
          pinSelectedMessage(message).catch(() => undefined);
        }}
        isOwn={Boolean(
          selectedMessage && user?.id && selectedMessage.from_id === user.id,
        )}
        themeColors={themeColors}
      />

      <ForwardMessageModal
        message={forwardMessage}
        friends={forwardFriends}
        selectedIds={forwardSelectedIds}
        loading={forwardLoading}
        error={forwardError}
        onClose={() => setForwardMessage(null)}
        onToggleRecipient={toggleForwardRecipient}
        onSubmit={() => {
          submitForward().catch(() => undefined);
        }}
        themeColors={themeColors}
      />
    </Screen>
  );
}

function assetToLocalImage(asset: Asset): LocalChatImage | null {
  if (!asset.uri || !asset.type) {
    return null;
  }

  return {
    id: `${asset.uri}-${asset.fileSize ?? Date.now()}`,
    uri: asset.uri,
    type: asset.type,
    fileName: asset.fileName || `chat-image-${Date.now()}.jpg`,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
  };
}

function assetToLocalVideoNote(asset?: Asset): LocalVideoNoteMessage | null {
  if (!asset?.uri) {
    return null;
  }

  const durationSeconds = Math.max(
    1,
    Math.round(asset.duration ?? CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS),
  );

  return {
    uri: asset.uri,
    type: asset.type || 'video/mp4',
    fileName: asset.fileName || `video-note-${Date.now()}.mp4`,
    durationSeconds,
    fileSize: asset.fileSize,
  };
}

function MessageBubble({
  message,
  outgoing,
  onImagePress,
  onVoicePress,
  playingVoiceUrl,
  onLongPress,
  themeColors,
}: {
  message: Message;
  outgoing: boolean;
  onImagePress: (url: string) => void;
  onVoicePress: (url: string) => void;
  playingVoiceUrl: string | null;
  onLongPress: () => void;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const displayContent =
    message.content ||
    (message.encryption_version && message.encryption_version > 0
      ? 'Не удалось расшифровать сообщение'
      : '');

  return (
    <Pressable
      style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}
      delayLongPress={280}
      onLongPress={onLongPress}
    >
      <View
        style={[
          styles.bubble,
          outgoing ? styles.outgoing : styles.incoming,
          outgoing ? themed.outgoingBubble : themed.incomingBubble,
        ]}
      >
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
          </Text>
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

        <Text
          style={[
            styles.messageDate,
            outgoing ? themed.outgoingSoftText : themed.softText,
          ]}
        >
          {formatDateTime(message.created_at)}
        </Text>
        {outgoing ? (
          <Text style={[styles.outgoingStatus, themed.outgoingSoftText]}>
            {message.is_read ? 'Прочитано' : 'Отправлено'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function VideoNoteAttachment({
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
        <Video
          source={{ uri: url }}
          style={[styles.videoNoteVideo, themed.surfaceMuted]}
          paused={!playing}
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

function MessageActionSheet({
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
  themeColors,
}: {
  message: Message | null;
  isOwn: boolean;
  onClose: () => void;
  onCopyText: (message: Message) => void;
  onCopyLink: (url: string) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  themeColors: ThemeColors;
}) {
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const trimmedText = message?.content.trim() ?? '';
  const messageUrl = message ? firstUrl(message.content) : '';

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

          {message ? (
            <Pressable
              accessibilityRole="button"
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

          {message && isOwn ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.sheetAction, styles.sheetDangerAction]}
              onPress={() => onDelete(message)}
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
                Удалить сообщение
              </Text>
            </Pressable>
          ) : null}

          {trimmedText ? (
            <Pressable
              accessibilityRole="button"
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

function ForwardMessageModal({
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

const createChatThemeStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
    },
    cardMuted: {
      backgroundColor: theme.cardMuted,
      borderColor: theme.border,
    },
    surfaceBar: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderTopColor: theme.border,
    },
    surfaceMutedBar: {
      backgroundColor: theme.surfaceMuted,
      borderTopColor: theme.border,
    },
    surfaceMuted: {
      backgroundColor: theme.surfaceMuted,
    },
    input: {
      backgroundColor: theme.input,
      borderColor: theme.border,
      color: theme.text,
    },
    text: {
      color: theme.text,
    },
    messageText: {
      color: theme.messageOtherText,
    },
    outgoingMessageText: {
      color: theme.messageOwnText,
    },
    outgoingAccentText: {
      color: theme.messageOwnText,
      opacity: 0.9,
    },
    outgoingMutedText: {
      color: theme.messageOwnText,
      opacity: 0.78,
    },
    outgoingSoftText: {
      color: theme.messageOwnText,
      opacity: 0.68,
    },
    outgoingLink: {
      color: theme.messageOwnText,
      textDecorationLine: 'underline',
    },
    mutedText: {
      color: theme.muted,
    },
    softText: {
      color: theme.soft,
    },
    accentText: {
      color: theme.accent,
    },
    dangerText: {
      color: theme.danger,
    },
    dangerSoft: {
      backgroundColor: theme.dangerSoft,
    },
    accentBg: {
      backgroundColor: theme.accent,
    },
    accentLeftBorder: {
      borderLeftColor: theme.accent,
    },
    incomingBubble: {
      backgroundColor: theme.messageOtherBg,
      borderColor: theme.messageOtherBorder,
    },
    outgoingBubble: {
      backgroundColor: theme.messageOwnBg,
      borderColor: theme.messageOwnBorder,
      borderWidth: 1,
    },
    replyPreview: {
      backgroundColor: theme.surfaceMuted,
      borderLeftColor: theme.accent,
    },
    voiceAttachment: {
      backgroundColor: theme.surfaceMuted,
    },
    videoNoteOrbit: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted,
      shadowColor: theme.accent,
    },
    videoNoteOrbitActive: {
      borderColor: theme.accentStrong,
    },
    videoNoteGlassButton: {
      borderColor: theme.isDark
        ? 'rgba(255, 255, 255, 0.34)'
        : 'rgba(255, 255, 255, 0.72)',
    },
    videoNotePill: {
      backgroundColor: theme.isDark
        ? 'rgba(2, 6, 23, 0.68)'
        : 'rgba(15, 23, 42, 0.56)',
    },
    videoNotePillProgress: {
      backgroundColor: theme.accentSoft,
    },
    sheetBackdrop: {
      backgroundColor: theme.overlay,
    },
    sheet: {
      backgroundColor: theme.surface,
    },
    sheetHandle: {
      backgroundColor: theme.border,
    },
    sheetActionIcon: {
      backgroundColor: theme.surfaceMuted,
      color: theme.muted,
    },
    forwardRecipient: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
    },
    forwardRecipientSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.selected,
    },
    forwardCheck: {
      backgroundColor: theme.surface,
      color: theme.muted,
    },
    forwardCheckSelected: {
      backgroundColor: theme.accent,
      color: theme.white,
    },
  });

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  loadingOlder: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  callActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  messageList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 18,
    gap: spacing.sm,
    flexGrow: 1,
  },
  emptyMessageList: {
    justifyContent: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  incoming: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outgoing: {
    backgroundColor: colors.accent,
  },
  messageText: {
    ...typography.body,
    color: colors.text,
  },
  outgoingText: {
    color: colors.white,
  },
  messageLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  outgoingLink: {
    color: colors.white,
    textDecorationLine: 'underline',
  },
  forwardedLabel: {
    ...typography.tiny,
    color: colors.accent,
    fontWeight: '800',
  },
  forwardedLabelOutgoing: {
    color: colors.white,
  },
  replyPreview: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  replyPreviewOutgoing: {
    borderLeftColor: colors.white,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  replyPreviewAuthor: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  replyPreviewAuthorOutgoing: {
    color: colors.white,
  },
  replyPreviewText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  replyPreviewTextOutgoing: {
    color: 'rgba(248, 250, 252, 0.82)',
  },
  messageDate: {
    ...typography.tiny,
    color: colors.soft,
    alignSelf: 'flex-end',
  },
  outgoingDate: {
    color: 'rgba(248, 250, 252, 0.78)',
  },
  outgoingStatus: {
    color: 'rgba(248, 250, 252, 0.78)',
    ...typography.tiny,
    alignSelf: 'flex-end',
  },
  messageImage: {
    width: 210,
    height: 150,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  attachmentDecryptError: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.dangerSoft,
  },
  attachmentDecryptErrorOutgoing: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  attachmentDecryptErrorText: {
    color: colors.danger,
    fontSize: 14,
    fontStyle: 'italic',
  },
  attachmentDecryptErrorTextOutgoing: {
    color: colors.white,
  },
  voiceAttachment: {
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  voiceAttachmentOutgoing: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  voicePlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  voicePlayButtonActive: {
    backgroundColor: colors.accentStrong,
  },
  voicePlayText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  voiceInfo: {
    flex: 1,
    minWidth: 0,
  },
  voiceTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  voiceTitleOutgoing: {
    color: colors.white,
  },
  voiceDuration: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  voiceDurationOutgoing: {
    color: 'rgba(248, 250, 252, 0.78)',
  },
  videoNoteAttachment: {
    width: 116,
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    backgroundColor: 'transparent',
  },
  videoNoteAttachmentOutgoing: {
    alignSelf: 'flex-end',
  },
  videoNoteOrbit: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    shadowColor: colors.accent,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  videoNoteOrbitActive: {
    borderColor: colors.accentStrong,
    shadowOpacity: 0.36,
    shadowRadius: 18,
  },
  videoNoteVideo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surfaceMuted,
  },
  videoNoteGlassButton: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.48)',
  },
  videoNoteIcon: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(2, 6, 23, 0.42)',
    textShadowRadius: 6,
  },
  videoNotePill: {
    minWidth: 48,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(2, 6, 23, 0.58)',
  },
  videoNotePillProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  videoNoteText: {
    minWidth: 42,
    color: colors.white,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    textAlign: 'center',
  },
  videoNoteTextOutgoing: {
    color: colors.white,
  },
  previewStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewItem: {
    width: 64,
    height: 64,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  previewRemove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  previewRemoveText: {
    color: colors.white,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
  },
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pinnedStripe: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  pinnedInfo: {
    flex: 1,
    minWidth: 0,
  },
  pinnedTitle: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  pinnedText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  pinnedHint: {
    color: colors.soft,
    fontSize: 11,
    lineHeight: 14,
  },
  sendStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sendStatusText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  e2eeStatusBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  e2eeStatusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  replyInfo: {
    flex: 1,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
  },
  replyTitle: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  replyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  editingInfo: {
    flex: 1,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
  },
  editingTitle: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  editingText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  editingCancel: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  editingCancelText: {
    color: colors.muted,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '600',
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.danger,
  },
  recordingTime: {
    minWidth: 38,
    color: colors.accentStrong,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  recordingText: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  voiceButtonRecording: {
    backgroundColor: colors.danger,
    opacity: 1,
  },
  recordingCancel: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  recordingCancelText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  recordingSend: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
  },
  recordingSendText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  previewVideoNoteCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewVideoNoteMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  previewVideoNoteActions: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 0,
    paddingTop: 0,
    gap: spacing.sm,
  },
  previewHint: {
    color: colors.soft,
    fontSize: 12,
    lineHeight: 16,
  },
  // Preview voice card (new UX: record -> preview -> send/delete)
  previewVoiceCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    gap: 8,
  },
  previewVoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewPlayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlayButtonActive: {
    backgroundColor: colors.accentStrong,
  },
  previewProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  previewProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  previewDuration: {
    minWidth: 72,
    textAlign: 'right',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    color: colors.muted,
  },
  previewMeta: {
    paddingLeft: 42,
  },
  previewMetaText: {
    fontSize: 10,
    color: colors.muted,
  },
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingLeft: 42,
    paddingTop: 4,
  },
  typingBar: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  typingText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  composer: {
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  composerTools: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  composerToolButton: {
    width: 42,
    height: 42,
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  composerSendButton: {
    width: 48,
    height: 48,
  },
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 15,
  },
  lightbox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 14,
  },
  lightboxImage: {
    width: '100%',
    height: '86%',
  },
  lightboxClose: {
    position: 'absolute',
    right: 18,
    top: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  lightboxCloseText: {
    color: colors.white,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '600',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.58)',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 4,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  sheetTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  sheetAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  sheetActionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  sheetActionText: {
    color: colors.text,
    ...typography.body,
    fontWeight: '600',
  },
  forwardPreview: {
    borderRadius: 14,
    padding: 10,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 6,
  },
  forwardPreviewText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  forwardError: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 6,
  },
  forwardLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  forwardEmpty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  forwardList: {
    maxHeight: 320,
    gap: 6,
  },
  forwardRecipient: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
  },
  forwardRecipientSelected: {
    borderColor: colors.accent,
  },
  forwardRecipientName: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  forwardCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    color: colors.muted,
    backgroundColor: colors.surface,
    fontSize: 17,
    lineHeight: 28,
    textAlign: 'center',
    fontWeight: '900',
  },
  forwardCheckSelected: {
    color: colors.white,
    backgroundColor: colors.accent,
  },
  forwardActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
  },
  forwardButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forwardCancelButton: {
    backgroundColor: colors.surfaceMuted,
  },
  forwardSubmitButton: {
    backgroundColor: colors.accent,
  },
  forwardCancelText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  forwardSubmitText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  sheetDangerAction: {
    marginTop: 2,
  },
  sheetDangerIcon: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  sheetDangerText: {
    color: colors.danger,
  },
});
