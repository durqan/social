import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { Asset, ImagePickerResponse } from 'react-native-image-picker';
import {
  Mic,
  Pause,
  Paperclip,
  Pencil,
  Play,
  Send,
  Smile,
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
  CHAT_IMAGE_MAX_COUNT,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
} from '../../config/env';
import { e2eeApi } from '../../api/e2ee';
import { friendsApi } from '../../api/friends';
import { getApiErrorMessage, getCookieHeader } from '../../api/http';
import {
  messageApi,
  validateLocalChatVideo,
  validateLocalChatImage,
  validateLocalVideoNoteMessage,
  validateLocalVoiceMessage,
  type LocalChatImage,
  type LocalChatVideo,
  type LocalVideoNoteMessage,
  type LocalVoiceMessage,
  type MessageDeleteMode,
  type UploadFilePart,
} from '../../api/messages';
import { compressLocalChatVideo } from '../../utils/chatVideo';
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
import { useNotifications } from '../../context/NotificationsContext';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import { formatDuration } from '../../utils/format';
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
import { setActivePushConversation } from '../../notifications/activeConversation';
import { MessageBubble, VideoNoteAttachment } from './chat/MessageBubble';
import { ForwardMessageModal, MessageActionSheet } from './chat/ChatModals';
import { createChatThemeStyles, styles } from './chat/chatStyles';
import {
  isPersistedMessage,
  messageAuthorName,
  messagePreviewText,
} from './chat/chatUtils';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;
type LoadMode = 'initial' | 'refresh' | 'silent';
type ComposerMediaMode = 'voice' | 'video_note';
type ScrollToLatestReason = 'initial_load' | 'own_message' | 'incoming_message';
type ChatE2EEState = {
  loading: boolean;
  selfEnabled: boolean;
  recipientEnabled: boolean;
  recipientPublicKey: string;
  localKey: LocalE2EEKeyBundle | null;
};
type SendingState =
  | 'preparingVideo'
  | 'compressingVideo'
  | 'uploading'
  | 'uploadingVoice'
  | 'uploadingVideo'
  | 'uploadingVideoNote'
  | 'sending'
  | null;

const COMPOSER_INPUT_MIN_HEIGHT = 48;
const COMPOSER_INPUT_MAX_HEIGHT = 136;
const KEYBOARD_INSET_UPDATE_DELAY_MS = 80;
const MESSAGE_PAGE_SIZE = 50;
const LOAD_OLDER_THRESHOLD = 56;
const COPY_NOTICE_TIMEOUT_MS = 1600;
const REMOTE_TYPING_TIMEOUT_MS = 2200;
const LOCAL_TYPING_STOP_DELAY_MS = 1400;
const LONG_PRESS_DELAY_MS = 260;
const SCROLL_EVENT_THROTTLE_MS = 80;
const voiceAudioSet = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.WEBM,
  AudioEncoderAndroid: AudioEncoderAndroidType.VORBIS,
  AudioChannels: 1,
  AudioSamplingRate: 44100,
  AudioEncodingBitRate: 64000,
} as const;





function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
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



function chatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'E2EE is not ready for this conversation' ||
      error.message === 'Recipient E2EE is not enabled'
    ) {
      return 'Не удалось отправить сообщение.';
    }
  }

  return getApiErrorMessage(error);
}


export default function ChatScreen({ route }: Props) {
  const { user } = useAuth();
  const themeColors = useThemeColors();
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const isFocused = useIsFocused();
  const { isForeground, networkConnected } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const { markMatchingAsRead } = useNotifications();
  const otherUserId = route.params.userId;
  const listRef = useRef<FlatList<Message>>(null);
  const hasLoadedRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const pendingScrollToLatestReasonRef = useRef<ScrollToLatestReason | null>(
    null,
  );
  const isInitialScrollPendingRef = useRef(false);
  const isUserNearBottomRef = useRef(true);
  const scrollToEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const draftRef = useRef<{
    input: string;
    pendingImages: LocalChatImage[];
    pendingVideo: LocalChatVideo | null;
  } | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingSecondsRef = useRef(0);
  const recordingActiveRef = useRef(false);
  const recordingMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previewProgressBarRef = useRef<View>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const otherTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previousNetworkConnectedRef = useRef(networkConnected);
  const baseChatLayoutHeightRef = useRef(0);
  const chatLayoutHeightRef = useRef(0);
  const androidKeyboardHeightRef = useRef(0);
  const keyboardInsetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const keyboardVisibleRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const [pendingImages, setPendingImages] = useState<LocalChatImage[]>([]);
  const [pendingVideo, setPendingVideo] = useState<LocalChatVideo | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
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
  const [maintainScrollPositionEnabled, setMaintainScrollPositionEnabled] =
    useState(false);
  const [sending, setSending] = useState<SendingState>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingVoiceUrl, setPlayingVoiceUrl] = useState<string | null>(null);
  const [messageActionPending, setMessageActionPending] = useState(false);

  const [pendingVoice, setPendingVoice] = useState<LocalVoiceMessage | null>(
    null,
  );
  const [pendingVideoNote, setPendingVideoNote] =
    useState<LocalVideoNoteMessage | null>(null);
  const [composerMediaMode, setComposerMediaMode] =
    useState<ComposerMediaMode>('voice');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [otherTyping, setOtherTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);
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

  const messagesRef = useLatest(messages);
  const hasMoreRef = useLatest(hasMore);
  const pendingImagesRef = useLatest(pendingImages);
  const pendingVideoRef = useLatest(pendingVideo);
  const pendingVideoNoteRef = useLatest(pendingVideoNote);
  const pendingVoiceRef = useLatest(pendingVoice);
  const playingVoiceUrlRef = useLatest(playingVoiceUrl);
  const previewPlayingRef = useLatest(previewPlaying);
  const sendingRef = useLatest<SendingState>(sending);
  const editingMessageRef = useLatest(editingMessage);
  const replyToMessageRef = useLatest(replyToMessage);
  const recordingBusyRef = useLatest(recordingBusy);
  const composerMediaHoldActiveRef = useRef(false);
  const messageActionPendingRef = useRef(false);
  const startVoiceRecordingRef = useRef<() => Promise<void> | void>(
    null as any,
  );
  const stopVoiceRecordingRef = useRef<(send: boolean) => Promise<void> | void>(
    null as any,
  );

  const applyAndroidKeyboardInset = useCallback(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!keyboardVisibleRef.current || androidKeyboardHeightRef.current <= 0) {
      setAndroidKeyboardInset(0);
      return;
    }

    const baseLayoutHeight =
      baseChatLayoutHeightRef.current || chatLayoutHeightRef.current;
    const currentLayoutHeight = chatLayoutHeightRef.current || baseLayoutHeight;
    const resizeDelta = Math.max(0, baseLayoutHeight - currentLayoutHeight);
    const nextInset = Math.max(
      0,
      Math.ceil(
        androidKeyboardHeightRef.current - resizeDelta - safeAreaInsets.bottom,
      ),
    );

    setAndroidKeyboardInset(previous =>
      Math.abs(previous - nextInset) > 1 ? nextInset : previous,
    );
  }, [safeAreaInsets.bottom]);

  const handleChatLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      chatLayoutHeightRef.current = height;

      if (
        !keyboardVisibleRef.current ||
        height > baseChatLayoutHeightRef.current
      ) {
        baseChatLayoutHeightRef.current = height;
      }

      requestAnimationFrame(applyAndroidKeyboardInset);
    },
    [applyAndroidKeyboardInset],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    requestAnimationFrame(applyAndroidKeyboardInset);
  }, [
    applyAndroidKeyboardInset,
    windowDimensions.height,
    windowDimensions.width,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', event => {
      keyboardVisibleRef.current = true;
      androidKeyboardHeightRef.current = event.endCoordinates.height;
      if (keyboardInsetTimerRef.current) {
        clearTimeout(keyboardInsetTimerRef.current);
      }
      requestAnimationFrame(applyAndroidKeyboardInset);
      keyboardInsetTimerRef.current = setTimeout(
        applyAndroidKeyboardInset,
        KEYBOARD_INSET_UPDATE_DELAY_MS,
      );
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      androidKeyboardHeightRef.current = 0;
      if (keyboardInsetTimerRef.current) {
        clearTimeout(keyboardInsetTimerRef.current);
        keyboardInsetTimerRef.current = null;
      }
      setAndroidKeyboardInset(0);
    });

    return () => {
      if (keyboardInsetTimerRef.current) {
        clearTimeout(keyboardInsetTimerRef.current);
        keyboardInsetTimerRef.current = null;
      }
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [applyAndroidKeyboardInset]);

  useEffect(() => {
    if (!copyNotice) {
      return undefined;
    }

    const timer = setTimeout(() => setCopyNotice(null), COPY_NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    return () => {
      if (recordingMaxTimerRef.current) {
        clearTimeout(recordingMaxTimerRef.current);
      }
      if (scrollToEndTimerRef.current) {
        clearTimeout(scrollToEndTimerRef.current);
        scrollToEndTimerRef.current = null;
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

  const scrollToLatestMessage = useCallback(
    (animated = hasLoadedRef.current) => {
      const reason = pendingScrollToLatestReasonRef.current;
      if (
        !reason ||
        isLoadingOlderRef.current ||
        (reason === 'incoming_message' && !isUserNearBottomRef.current)
      ) {
        pendingScrollToLatestReasonRef.current = null;
        return;
      }

      setMaintainScrollPositionEnabled(false);

      if (scrollToEndTimerRef.current) {
        clearTimeout(scrollToEndTimerRef.current);
        scrollToEndTimerRef.current = null;
      }

      const scroll = () => {
        listRef.current?.scrollToEnd({ animated });
      };

      requestAnimationFrame(scroll);
      scrollToEndTimerRef.current = setTimeout(() => {
        scroll();
        requestAnimationFrame(scroll);
        pendingScrollToLatestReasonRef.current = null;
        isInitialScrollPendingRef.current = false;
        isUserNearBottomRef.current = true;
        scrollToEndTimerRef.current = null;
        setMaintainScrollPositionEnabled(true);
      }, 120);
    },
    [],
  );

  const requestScrollToLatest = useCallback(
    (reason: ScrollToLatestReason, animated = hasLoadedRef.current) => {
      if (
        reason === 'incoming_message' &&
        !isUserNearBottomRef.current &&
        !isInitialScrollPendingRef.current
      ) {
        return;
      }

      pendingScrollToLatestReasonRef.current = reason;
      scrollToLatestMessage(animated);
    },
    [scrollToLatestMessage],
  );

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

      const attachment =
        fileType === 'video'
          ? await messageApi.uploadVideo(
              {
                ...uploadFile,
                durationSeconds: source.durationSeconds || 0,
                width: source.width,
                height: source.height,
              },
              {
                ...encrypted.fields,
                width: encrypted.metadata.width,
                height: encrypted.metadata.height,
                durationSeconds: source.durationSeconds || 0,
              },
            )
          : await messageApi.uploadImage(uploadFile, {
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
    markMatchingAsRead({
      types: ['message_received'],
      conversation_id: otherUserId,
    }).catch(() => undefined);
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
  }, [
    markMatchingAsRead,
    otherUserId,
    refreshUnreadCount,
    signalChatDataChanged,
    user?.id,
  ]);

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
          limit: MESSAGE_PAGE_SIZE,
        });
        const shouldInitialScroll =
          mode === 'initial' &&
          (!hasLoadedRef.current || messagesRef.current.length === 0);
        const displayMessages = await decryptChatMessages(response.messages);

        isInitialScrollPendingRef.current = shouldInitialScroll;
        pendingScrollToLatestReasonRef.current = shouldInitialScroll
          ? 'initial_load'
          : null;
        setMaintainScrollPositionEnabled(!shouldInitialScroll);
        hasMoreRef.current = response.has_more;
        setHasMore(response.has_more);
        setMessages(displayMessages);

        if (shouldInitialScroll) {
          requestScrollToLatest('initial_load', false);
        }

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
    [
      decryptChatMessages,
      hasMoreRef,
      messagesRef,
      markConversationRead,
      otherUserId,
      requestScrollToLatest,
    ],
  );

  const loadOlderMessages = useCallback(async () => {
    const currentMessages = messagesRef.current;
    const oldestMessage = currentMessages[0];

    if (
      isLoadingOlderRef.current ||
      !hasMoreRef.current ||
      !oldestMessage ||
      refreshing
    ) {
      return;
    }

    isLoadingOlderRef.current = true;
    pendingScrollToLatestReasonRef.current = null;
    setMaintainScrollPositionEnabled(true);
    setLoadingOlder(true);

    try {
      const response = await messageApi.getMessagesWith(otherUserId, {
        before: oldestMessage.id,
        limit: MESSAGE_PAGE_SIZE,
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
      isLoadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [decryptChatMessages, hasMoreRef, messagesRef, otherUserId, refreshing]);

  const handleMessagesScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      isUserNearBottomRef.current = distanceFromBottom <= 96;

      if (contentOffset.y > LOAD_OLDER_THRESHOLD) {
        return;
      }

      loadOlderMessages().catch(() => undefined);
    },
    [loadOlderMessages],
  );

  const handleMessageListContentSizeChange = useCallback(() => {
    if (pendingScrollToLatestReasonRef.current && !isLoadingOlderRef.current) {
      scrollToLatestMessage();
    }
  }, [scrollToLatestMessage]);

  useEffect(() => {
    if (
      pendingScrollToLatestReasonRef.current &&
      !isLoadingOlderRef.current &&
      messages.length > 0
    ) {
      scrollToLatestMessage(false);
    }
  }, [messages.length, scrollToLatestMessage]);

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
      setActivePushConversation(otherUserId);
      return () => {
        chatSocket.clearActiveConversation();
        setActivePushConversation(null);
      };
    }

    chatSocket.clearActiveConversation();
    setActivePushConversation(null);
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
    setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setPendingImages(draftRef.current.pendingImages);
    setPendingVideo(draftRef.current.pendingVideo);
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
          }, REMOTE_TYPING_TIMEOUT_MS);
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
            if (displayMessage.from_id === user?.id) {
              pendingScrollToLatestReasonRef.current = 'own_message';
            } else if (isUserNearBottomRef.current) {
              pendingScrollToLatestReasonRef.current = 'incoming_message';
            }
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
      messagesRef,
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

  function handlePickerError(defaultMessage: string, apiError: unknown) {
    setError(getApiErrorMessage(apiError) || defaultMessage);
  }

  async function applyPickedComposerMedia(result: ImagePickerResponse) {
    if (result.didCancel) {
      return;
    }

    if (result.errorMessage) {
      setError('Не удалось выбрать файл. Попробуйте еще раз.');
      return;
    }

    const assets = result.assets || [];
    if (assets.length === 0) {
      setError('Не удалось подготовить вложение. Попробуйте еще раз.');
      return;
    }

    const videoAsset = assets.find(asset =>
      (asset.type || '').startsWith('video/'),
    );
    if (videoAsset) {
      if (pendingImages.length > 0 || assets.length > 1) {
        setError('В MVP можно отправить одно видео без других вложений');
        return;
      }
      const video = assetToLocalVideo(videoAsset);
      if (!video) {
        setError('Не удалось выбрать видео. Попробуйте еще раз.');
        return;
      }
      const validationError = validateLocalChatVideo(video);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);
      setPendingVideo(video);
      return;
    }

    const images = assets
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

  async function pickImagesFromLibrary() {
    if (pendingVideo || pendingVideoRef.current) {
      setError('Сначала отправьте или удалите выбранное видео');
      return;
    }
    const remaining = CHAT_IMAGE_MAX_COUNT - pendingImages.length;
    if (remaining <= 0) {
      setError(
        `Можно прикрепить не больше ${CHAT_IMAGE_MAX_COUNT} изображений`,
      );
      return;
    }

    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: remaining,
        includeExtra: true,
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.8,
      });

      await applyPickedComposerMedia(result);
    } catch (apiError) {
      handlePickerError(
        'Не удалось выбрать файл. Попробуйте еще раз.',
        apiError,
      );
    }
  }

  async function ensureCameraPermission() {
    if (Platform.OS !== 'android') {
      return true;
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Доступ к камере',
        message: 'Разрешите доступ к камере, чтобы сделать фото.',
        buttonNegative: 'Отмена',
        buttonPositive: 'Разрешить',
      },
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function takePhoto() {
    if (pendingVideo || pendingVideoRef.current) {
      setError('Сначала отправьте или удалите выбранное видео');
      return;
    }
    if (pendingImages.length >= CHAT_IMAGE_MAX_COUNT) {
      setError(
        `Можно прикрепить не больше ${CHAT_IMAGE_MAX_COUNT} изображений`,
      );
      return;
    }

    try {
      const permitted = await ensureCameraPermission();
      if (!permitted) {
        const message = 'Разрешите доступ к камере, чтобы сделать фото';
        setError(message);
        Alert.alert('Нет доступа к камере', message);
        return;
      }

      const result = await launchCamera({
        mediaType: 'photo',
        includeExtra: true,
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.8,
        saveToPhotos: false,
      });

      await applyPickedComposerMedia(result);
    } catch (apiError) {
      handlePickerError(
        'Не удалось сделать фото. Попробуйте еще раз.',
        apiError,
      );
    }
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

  function voiceRecorderErrorMessage(apiError: unknown) {
    const rawMessage =
      apiError instanceof Error ? apiError.message : String(apiError || '');
    if (/start failed/i.test(rawMessage)) {
      return 'Не удалось начать запись. Проверьте доступ к микрофону и попробуйте еще раз.';
    }
    return getApiErrorMessage(apiError);
  }

  async function stopSoundBeforeRecording() {
    Sound.removePlaybackEndListener();
    Sound.removePlayBackListener();
    Sound.removeRecordBackListener();
    await Sound.stopPlayer().catch(() => undefined);
    await Sound.stopRecorder().catch(() => undefined);
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
    if (
      pendingImagesRef.current.length > 0 ||
      pendingVoiceRef.current ||
      pendingVideoRef.current ||
      pendingVideoNoteRef.current
    ) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }

    recordingBusyRef.current = true;
    setRecordingBusy(true);
    setError(null);

    try {
      const permitted = await ensureRecordAudioPermission();
      if (!permitted) {
        const message =
          'Разрешите доступ к микрофону, чтобы записать голосовое сообщение';
        setError(message);
        Alert.alert('Нет доступа к микрофону', message);
        return;
      }

      await stopSoundBeforeRecording();
      Sound.setSubscriptionDuration(0.25);
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
      clearRecordingLimitTimer();
      Sound.removeRecordBackListener();
      await Sound.stopRecorder().catch(() => undefined);
      recordingActiveRef.current = false;
      recordingStartedAtRef.current = 0;
      recordingSecondsRef.current = 0;
      setRecording(false);
      setRecordingSeconds(0);
      setError(voiceRecorderErrorMessage(apiError));
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
        pendingScrollToLatestReasonRef.current = 'own_message';
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }
      if (comment) {
        setInput('');
        setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
      pendingVoiceRef.current ||
      pendingVideoRef.current ||
      pendingVideoNoteRef.current
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
        pendingScrollToLatestReasonRef.current = 'own_message';
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }

      if (comment) {
        setInput('');
        setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
      if (messageActionPendingRef.current || sendingRef.current) {
        return;
      }

      messageActionPendingRef.current = true;
      setMessageActionPending(true);
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
            setError('Не удалось отредактировать сообщение');
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
            setError('Не удалось отредактировать сообщение');
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
          setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
        setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
        setEditingMessage(null);
        stopLocalTyping();
        signalChatDataChanged();
      } catch (apiError) {
        setError(chatErrorMessage(apiError));
      } finally {
        messageActionPendingRef.current = false;
        setMessageActionPending(false);
        setSending(null);
      }
      return;
    }

    if (!trimmed && pendingImages.length === 0 && !pendingVideo) {
      setError('Введите сообщение или выберите вложение');
      return;
    }

    let uploadFailed = false;
    setSending(
      pendingVideo
        ? 'preparingVideo'
        : pendingImages.length > 0
        ? 'uploading'
        : 'sending',
    );
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
      if (pendingVideo) {
        try {
          const compressedVideo = await compressLocalChatVideo(
            pendingVideo,
            stage => {
              setSending(
                stage === 'compressing' ? 'compressingVideo' : 'preparingVideo',
              );
            },
          );
          setSending('uploadingVideo');
          attachments.push(
            e2eeReady
              ? await encryptAndUploadAttachment(
                  compressedVideo,
                  'video',
                  otherUserId,
                )
              : await messageApi.uploadVideo(compressedVideo),
          );
        } catch (apiError) {
          uploadFailed = true;
          throw apiError;
        }
      }
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
        pendingVideo,
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
        pendingScrollToLatestReasonRef.current = 'own_message';
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }

      setInput('');
      setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
      setPendingImages([]);
      setPendingVideo(null);
      setReplyToMessage(null);
      stopLocalTyping();
    } catch (apiError) {
      const message = chatErrorMessage(apiError);
      setError(
        uploadFailed
          ? `${message} Удалите вложение из предпросмотра или попробуйте отправить снова.`
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

  function removePendingVideo() {
    setPendingVideo(null);
  }

  async function importLinkPreviewVideo(message: Message) {
    if (
      !message.link_preview ||
      message.link_preview.status === 'importing' ||
      message.link_preview.status === 'ready'
    ) {
      return;
    }

    setMessages(previous =>
      previous.map(item =>
        item.id === message.id && item.link_preview
          ? {
              ...item,
              link_preview: {
                ...item.link_preview,
                status: 'importing',
                import_error: null,
              },
            }
          : item,
      ),
    );

    try {
      const updated = await messageApi.importLinkPreviewVideo(message.id);
      const displayMessage = await decryptIncomingMessage(updated);
      setMessages(previous =>
        previous.map(item =>
          item.id === displayMessage.id ? displayMessage : item,
        ),
      );
    } catch (apiError) {
      setError(chatErrorMessage(apiError));
      setMessages(previous =>
        previous.map(item =>
          item.id === message.id && item.link_preview
            ? {
                ...item,
                link_preview: {
                  ...item.link_preview,
                  status: 'failed',
                  import_error: 'Не удалось сохранить видео',
                },
              }
            : item,
        ),
      );
    }
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
      setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
    }, LOCAL_TYPING_STOP_DELAY_MS);
  }

  function handleComposerContentSizeChange(contentHeight: number) {
    const nextHeight = Math.min(
      COMPOSER_INPUT_MAX_HEIGHT,
      Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.ceil(contentHeight) + 16),
    );
    setInputHeight(nextHeight);
  }

  function handleComposerFocus() {
    // Focusing the composer must not move the message list. Scroll is driven by
    // explicit message events only.
  }

  async function openComposerAttachments() {
    if (
      pendingVoiceRef.current ||
      pendingVideoRef.current ||
      pendingVideoNoteRef.current
    ) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }

    Alert.alert('Вложение', undefined, [
      {
        text: 'Сделать фото',
        onPress: () => {
          takePhoto().catch(() => {
            setError('Не удалось сделать фото. Попробуйте еще раз.');
          });
        },
      },
      {
        text: 'Выбрать из галереи',
        onPress: () => {
          pickImagesFromLibrary().catch(() => {
            setError('Не удалось выбрать файл. Попробуйте еще раз.');
          });
        },
      },
      {
        text: 'Отмена',
        style: 'cancel',
      },
    ]);
  }

  function showComposerStickerNotice() {
    setError(null);
    setCopyNotice('Стикеры пока не реализованы');
  }

  function toggleComposerMediaMode() {
    if (
      recordingActiveRef.current ||
      recordingBusyRef.current ||
      sendingRef.current ||
      editingMessageRef.current
    ) {
      return;
    }

    setComposerMediaMode(previous =>
      previous === 'voice' ? 'video_note' : 'voice',
    );
  }

  async function startComposerMediaRecording() {
    if (
      sendingRef.current ||
      editingMessageRef.current ||
      recordingBusyRef.current
    ) {
      return;
    }

    composerMediaHoldActiveRef.current = true;
    if (composerMediaMode === 'voice') {
      await startVoiceRecording();
      if (!composerMediaHoldActiveRef.current && recordingActiveRef.current) {
        await stopVoiceRecording(true);
      }
      return;
    }

    // TODO: full hold-to-record video notes need a custom camera/recorder.
    await recordVideoNote();
  }

  function stopComposerMediaRecording() {
    const shouldStopVoice =
      composerMediaHoldActiveRef.current && composerMediaMode === 'voice';

    composerMediaHoldActiveRef.current = false;
    if (shouldStopVoice) {
      stopVoiceRecording(true).catch(() => undefined);
    }
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

  async function deleteSelectedMessage(
    message: Message,
    mode: MessageDeleteMode = 'for_me',
  ) {
    if (messageActionPendingRef.current || sendingRef.current) {
      return;
    }

    messageActionPendingRef.current = true;
    setMessageActionPending(true);
    setSelectedMessage(null);

    try {
      if (isPersistedMessage(message)) {
        await messageApi.deleteMessage(message.id, mode);
      }
      setMessages(previous => previous.filter(item => item.id !== message.id));
      setPinnedMessage(previous =>
        previous?.message_id === message.id ? null : previous,
      );
      signalChatDataChanged();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      messageActionPendingRef.current = false;
      setMessageActionPending(false);
    }
  }

  function startEditingMessage(message: Message) {
    setSelectedMessage(null);
    setPendingImages([]);
    setReplyToMessage(null);
    stopLocalTyping();
    setEditingMessage(message);
    setInput(message.content);
    setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    setError(null);
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setInput('');
    setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
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
          pendingScrollToLatestReasonRef.current = 'own_message';
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
        pendingScrollToLatestReasonRef.current = 'own_message';
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

  const trimmedInput = input.trim();
  const showComposerSendButton =
    Boolean(trimmedInput) ||
    Boolean(editingMessage) ||
    pendingImages.length > 0 ||
    Boolean(pendingVideo);
  const composerMediaIcon = composerMediaMode === 'voice' ? Mic : VideoIcon;
  const composerMediaLabel =
    composerMediaMode === 'voice'
      ? 'Микрофон. Нажмите, чтобы выбрать видео-сообщение, удерживайте для записи'
      : 'Видео-сообщение. Нажмите, чтобы выбрать микрофон, удерживайте для записи';
  const composerMediaDisabled =
    Boolean(sending) || Boolean(editingMessage) || recordingBusy;

  return (
    <Screen
      scroll={false}
      padded={false}
      avoidKeyboard
      contentContainerStyle={styles.container}
      onLayout={handleChatLayout}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={copyNotice} />

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
          style={styles.messageListContainer}
          data={messages}
          keyExtractor={item => String(item.id)}
          refreshing={refreshing}
          onRefresh={() => loadMessages('refresh')}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={
            maintainScrollPositionEnabled
              ? { minIndexForVisible: 0 }
              : undefined
          }
          onScroll={handleMessagesScroll}
          scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              outgoing={item.from_id === user?.id}
              onImagePress={setSelectedImageUrl}
              onVideoPress={setSelectedVideoUrl}
              onImportLinkPreviewVideo={importLinkPreviewVideo}
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

      <View
        style={[
          styles.composerDock,
          themed.composerDock,
          androidKeyboardInset > 0
            ? { marginBottom: androidKeyboardInset }
            : null,
        ]}
      >
        {pendingImages.length > 0 ? (
          <View style={[styles.previewStrip, themed.surfaceBar]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.previewStripContent}
            >
              {pendingImages.map(image => (
                <View key={image.id} style={styles.previewItem}>
                  <Image
                    source={{ uri: image.uri }}
                    style={styles.previewImage}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Убрать вложение"
                    style={styles.previewRemove}
                    onPress={() => removePendingImage(image.id)}
                  >
                    <Text style={styles.previewRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {pendingVideo ? (
          <View style={[styles.previewVideoCard, themed.surfaceBar]}>
            <Video
              source={{ uri: pendingVideo.uri }}
              style={styles.previewVideo}
              paused
              resizeMode="cover"
            />
            <View style={styles.previewVideoMeta}>
              <Text
                style={[styles.previewVideoTitle, themed.text]}
                numberOfLines={1}
              >
                {pendingVideo.fileName}
              </Text>
              <Text style={[styles.previewVideoSubtitle, themed.mutedText]}>
                Видео
                {pendingVideo.durationSeconds
                  ? ` · ${formatDuration(pendingVideo.durationSeconds)}`
                  : ''}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Убрать видео"
              style={styles.previewRemove}
              onPress={removePendingVideo}
            >
              <Text style={styles.previewRemoveText}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {sending ? (
          <View style={[styles.sendStatus, themed.surfaceBar]}>
            <ActivityIndicator color={themeColors.accent} />
            <Text style={[styles.sendStatusText, themed.mutedText]}>
              {sending === 'uploadingVoice'
                ? 'Загружаем голосовое сообщение'
                : sending === 'preparingVideo'
                ? 'Подготовка видео...'
                : sending === 'compressingVideo'
                ? 'Сжатие видео...'
                : sending === 'uploadingVideo'
                ? 'Загрузка видео...'
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
              <Text style={[styles.editingCancelText, themed.mutedText]}>
                ×
              </Text>
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
              <Text style={[styles.editingCancelText, themed.mutedText]}>
                ×
              </Text>
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
            <View
              style={[styles.previewActions, styles.previewVideoNoteActions]}
            >
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
                  <Pause
                    color={themeColors.white}
                    size={16}
                    strokeWidth={2.6}
                  />
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
            onPress={openComposerAttachments}
            style={styles.composerSideButton}
          />

          <View style={styles.composerInputContainer}>
            <TextInput
              value={input}
              onChangeText={handleComposerTextChange}
              onFocus={handleComposerFocus}
              onContentSizeChange={event =>
                handleComposerContentSizeChange(
                  event.nativeEvent.contentSize.height,
                )
              }
              placeholder="Сообщение…"
              placeholderTextColor={themeColors.soft}
              multiline
              scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
              maxLength={1000}
              editable={!sending && !recording && !recordingBusy}
              textAlignVertical="top"
              style={[styles.input, themed.text, { height: inputHeight }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Стикеры"
              accessibilityState={{
                disabled: Boolean(sending) || recording || recordingBusy,
              }}
              disabled={Boolean(sending) || recording || recordingBusy}
              hitSlop={6}
              onPress={showComposerStickerNotice}
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
                  pendingImages.length === 0 &&
                  !pendingVideo) ||
                Boolean(pendingVoice) ||
                Boolean(pendingVideoNote)
              }
              loading={Boolean(sending)}
              onPress={sendMessage}
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
              onPress={toggleComposerMediaMode}
              onLongPress={() => {
                startComposerMediaRecording().catch(() => undefined);
              }}
              onPressOut={stopComposerMediaRecording}
              style={[
                styles.composerActionButton,
                recording ? styles.composerActionRecording : undefined,
              ]}
            />
          )}
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
      <Modal
        visible={Boolean(selectedVideoUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedVideoUrl(null)}
      >
        <View style={styles.lightbox}>
          <Pressable
            style={styles.lightboxBackdrop}
            onPress={() => setSelectedVideoUrl(null)}
          />
          {selectedVideoUrl ? (
            <Video
              source={{ uri: selectedVideoUrl }}
              style={styles.lightboxVideo}
              controls
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            style={styles.lightboxClose}
            onPress={() => setSelectedVideoUrl(null)}
          >
            <Text style={styles.lightboxCloseText}>×</Text>
          </Pressable>
        </View>
      </Modal>

      <MessageActionSheet
        message={selectedMessage}
        onClose={() => setSelectedMessage(null)}
        onCopyText={message =>
          copyValue(message.content.trim(), 'Текст скопирован')
        }
        onCopyLink={url => copyValue(url, 'Ссылка скопирована')}
        onDelete={(message, mode) => {
          deleteSelectedMessage(message, mode).catch(() => undefined);
        }}
        onEdit={startEditingMessage}
        onReply={startReply}
        onForward={openForwardDialog}
        onPin={message => {
          pinSelectedMessage(message).catch(() => undefined);
        }}
        actionPending={messageActionPending || Boolean(sending)}
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

function assetToLocalVideo(asset?: Asset): LocalChatVideo | null {
  if (!asset?.uri) {
    return null;
  }
  return {
    id: `${asset.uri}-${asset.fileSize ?? Date.now()}`,
    uri: asset.uri,
    type: asset.type || 'video/mp4',
    fileName: asset.fileName || `chat-video-${Date.now()}.mp4`,
    durationSeconds: asset.duration
      ? Math.max(1, Math.round(asset.duration))
      : undefined,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
  };
}



