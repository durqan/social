import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Keyboard,
  PermissionsAndroid,
  Platform,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  errorCodes as documentPickerErrorCodes,
  isErrorWithCode as isDocumentPickerErrorWithCode,
  pick as pickDocuments,
} from '@react-native-documents/picker';
import type {
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
  TextInput,
} from 'react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { ImagePickerResponse } from 'react-native-image-picker';
import { Mic, Video as VideoIcon } from 'lucide-react-native';
import Sound from 'react-native-nitro-sound';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CommonActions, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { WS_EVENTS } from '@social/shared';

import {
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_BLOCKED_ATTACHMENT_EXTENSIONS,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  formatFileSize,
} from '@social/shared';
import { e2eeApi } from '../../api/e2ee';
import { friendsApi } from '../../api/friends';
import { getApiErrorMessage, getCookieHeader } from '../../api/http';
import {
  messageApi,
  validateLocalChatFile,
  validateLocalChatVideo,
  validateLocalChatImage,
  validateLocalVideoNoteMessage,
  validateLocalVoiceMessage,
  type LocalChatFile,
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
} from '@social/shared';
import { chatSocket, type WsEvent } from '../../api/ws';
import {
  ErrorBanner,
  SuccessBanner,
} from '../../components/Feedback';
import { MiniProfileSheet } from '../../components/MiniProfileSheet';
import { Screen } from '../../components/Screen';
import { useAppLifecycle } from '../../context/AppLifecycleContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationsContext';
import { useUnread } from '../../context/UnreadContext';
import { useThemeColors } from '../../theme/ThemeContext';
import { useAppResumeEffect } from '../../utils/useAppResumeEffect';
import { useLatest } from '../../utils/useLatest';
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
import {
  downloadAttachmentErrorMessage,
  downloadChatAttachment,
  isAttachmentDownloadable,
} from '../../features/chat/lib/attachmentDownload';
import { ChatDoodleBackground } from '../../features/chat/components/ChatDoodleBackground';
import { setActivePushConversation } from '../../notifications/activeConversation';
import { ChatHeaderTitleButton } from '../../features/chat/components/ChatHeaderTitleButton';
import { MessageBubble } from '../../features/chat/components/MessageBubble';
import { ChatLightboxes } from '../../features/chat/components/ChatLightboxes';
import { ChatMessageList } from '../../features/chat/components/ChatMessageList';
import {
  ChatScrollView,
  type ChatScrollViewRef,
} from '../../features/chat/components/ChatScrollView';
import { ChatComposerDock } from '../../features/chat/components/ChatComposerDock';
import { ChatPinnedMessageBar } from '../../features/chat/components/ChatPinnedMessageBar';
import {
  ForwardMessageModal,
  MessageActionSheet,
} from '../../features/chat/components/ChatModals';
import {
  createChatThemeStyles,
  styles,
} from '../../features/chat/lib/chatStyles';
import { isPersistedMessage } from '../../features/chat/lib/chatUtils';
import {
  chatErrorMessage,
  mergeMessageLists,
  messageBelongsToChat,
  shouldApplyMessageUpdate,
} from '../../features/chat/lib/messageState';
import {
  CHAT_INPUT_NATIVE_ID,
  COMPOSER_ESTIMATED_DOCK_HEIGHT,
  COMPOSER_INPUT_MAX_HEIGHT,
  COMPOSER_INPUT_MIN_HEIGHT,
  COPY_NOTICE_TIMEOUT_MS,
  LOAD_OLDER_THRESHOLD,
  LOCAL_TYPING_STOP_DELAY_MS,
  MESSAGE_LIST_BOTTOM_GAP,
  MESSAGE_LIST_TAP_MOVE_THRESHOLD,
  MESSAGE_PAGE_SIZE,
  NEAR_LATEST_THRESHOLD,
  REMOTE_TYPING_TIMEOUT_MS,
  SCROLL_TO_LATEST_BUTTON_GAP,
  documentPickerMimeTypes,
  voiceAudioSet,
  type ComposerMediaMode,
  type SendingState,
} from '../../features/chat/lib/chatScreenConfig';
import {
  assetToLocalVideoNote,
  assetToPendingAttachment,
  documentToPendingAttachment,
  extensionFromFileName,
  type PendingChatAttachment,
} from '../../features/chat/lib/pendingAttachments';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import {
  AndroidSoftInputModes,
  KeyboardController,
  KeyboardGestureArea,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;
type LoadMode = 'initial' | 'refresh' | 'silent';
type ScrollToLatestReason = 'initial_load' | 'own_message' | 'incoming_message';
type ChatE2EEState = {
  loading: boolean;
  selfEnabled: boolean;
  recipientEnabled: boolean;
  recipientPublicKey: string;
  localKey: LocalE2EEKeyBundle | null;
};
type MessageListMetrics = {
  contentHeight: number;
  layoutHeight: number;
  offsetY: number;
};
type PendingLatestScroll = {
  reason: ScrollToLatestReason;
  animated: boolean;
};

export default function ChatScreen({ route, navigation }: Props) {
  const { user } = useAuth();
  const themeColors = useThemeColors();
  const themed = useMemo(
    () => createChatThemeStyles(themeColors),
    [themeColors],
  );
  const isFocused = useIsFocused();
  const { isForeground, networkConnected } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const { markMatchingAsRead } = useNotifications();
  const otherUserId = route.params.userId;
  const listRef = useRef<LegendListRef>(null);
  const chatScrollViewRef = useRef<ChatScrollViewRef | null>(null);
  const composerInputRef = useRef<TextInput>(null);
  const composerRef = useRef<View>(null);
  const composerBaseHeightRef = useRef(COMPOSER_ESTIMATED_DOCK_HEIGHT);
  const hasLoadedRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const pendingLatestScrollRef = useRef<PendingLatestScroll | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const isInitialScrollPendingRef = useRef(false);
  const isUserNearBottomRef = useRef(true);
  const messageListTapRef = useRef({
    startX: 0,
    startY: 0,
    startTimestamp: 0,
    moved: false,
  });
  const lastMessageTouchTimestampRef = useRef(0);
  const messageListMetricsRef = useRef<MessageListMetrics>({
    contentHeight: 0,
    layoutHeight: 0,
    offsetY: 0,
  });
  const draftRef = useRef<{
    input: string;
    pendingAttachments: PendingChatAttachment[];
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
  const screenMountedRef = useRef(true);
  const chatSessionSeqRef = useRef(0);
  const loadMessagesSeqRef = useRef(0);
  const loadPinnedSeqRef = useRef(0);
  const loadMessagesAbortRef = useRef<AbortController | null>(null);
  const loadPinnedAbortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingChatAttachment[]
  >([]);
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
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(false);
  const [miniProfileVisible, setMiniProfileVisible] = useState(false);

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
  const insets = useSafeAreaInsets();
  const messageListBottomPadding =
    COMPOSER_ESTIMATED_DOCK_HEIGHT + insets.bottom + MESSAGE_LIST_BOTTOM_GAP;
  const scrollToLatestBottomOffset =
    COMPOSER_ESTIMATED_DOCK_HEIGHT + insets.bottom + SCROLL_TO_LATEST_BUTTON_GAP;
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

  const extraContentPadding = useSharedValue(0);
  const composerHasExtraContent = useMemo(
    () =>
      pendingAttachments.length > 0 ||
      Boolean(sending) ||
      Boolean(editingMessage) ||
      Boolean(replyToMessage) ||
      recording ||
      Boolean(pendingVideoNote) ||
      Boolean(pendingVoice) ||
      otherTyping,
    [
      editingMessage,
      otherTyping,
      pendingAttachments.length,
      pendingVideoNote,
      pendingVoice,
      recording,
      replyToMessage,
      sending,
    ],
  );
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <ChatScrollView
        {...props}
        chatScrollViewRef={chatScrollViewRef}
        extraContentPadding={extraContentPadding}
      />
    ),
    [extraContentPadding],
  );
  const handleComposerDockLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.ceil(event.nativeEvent.layout.height);

      if (
        !composerHasExtraContent &&
        inputHeight === COMPOSER_INPUT_MIN_HEIGHT
      ) {
        composerBaseHeightRef.current = height;
      }

      extraContentPadding.value = withTiming(
        Math.max(height - composerBaseHeightRef.current, 0),
        { duration: 250 },
      );
    },
    [composerHasExtraContent, extraContentPadding, inputHeight],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () => (
        <ChatHeaderTitleButton
          name={route.params.name}
          textColor={themeColors.text}
          onPress={() => setMiniProfileVisible(true)}
        />
      ),
    });
  }, [navigation, route.params.name, themeColors.text]);

  const messagesRef = useLatest(messages);
  const hasMoreRef = useLatest(hasMore);
  const pendingAttachmentsRef = useLatest(pendingAttachments);
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

  const isCurrentChatSession = useCallback((sessionSeq: number) => {
    return screenMountedRef.current && chatSessionSeqRef.current === sessionSeq;
  }, []);

  useEffect(() => {
    screenMountedRef.current = true;

    return () => {
      screenMountedRef.current = false;
      chatSessionSeqRef.current += 1;
      loadMessagesSeqRef.current += 1;
      loadPinnedSeqRef.current += 1;
    };
  }, [playingVoiceUrlRef, previewPlayingRef]);

  useEffect(() => {
    chatSessionSeqRef.current += 1;
    loadMessagesSeqRef.current += 1;
    loadPinnedSeqRef.current += 1;
    hasLoadedRef.current = false;
    isLoadingOlderRef.current = false;
    pendingLatestScrollRef.current = null;
    if (pendingScrollFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollFrameRef.current);
      pendingScrollFrameRef.current = null;
    }
    isInitialScrollPendingRef.current = false;
    isUserNearBottomRef.current = true;
    messageListMetricsRef.current = {
      contentHeight: 0,
      layoutHeight: 0,
      offsetY: 0,
    };
    setMessages([]);
    setHasLoaded(false);
    setHasMore(true);
    setLoading(false);
    setRefreshing(false);
    setLoadingOlder(false);
    setPinnedMessage(null);
    setSelectedMessage(null);
    setEditingMessage(null);
    setReplyToMessage(null);
    setError(null);
    setShowScrollToLatest(false);
    setNewMessagesBelow(false);
  }, [otherUserId, user?.id]);

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
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
        pendingScrollFrameRef.current = null;
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
      if (isLoadingOlderRef.current) {
        return;
      }

      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }

      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        pendingScrollFrameRef.current = null;
        chatScrollViewRef.current?.scrollToEnd({ animated });
        pendingLatestScrollRef.current = null;
        isInitialScrollPendingRef.current = false;
        isUserNearBottomRef.current = true;
        setShowScrollToLatest(false);
        setNewMessagesBelow(false);
      });
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      composerInputRef.current?.blur();
    });

    return () => {
      hideSubscription.remove();
    };
  }, []);

  const requestScrollToLatest = useCallback(
    (reason: ScrollToLatestReason, animated = hasLoadedRef.current) => {
      if (
        reason === 'incoming_message' &&
        !isUserNearBottomRef.current &&
        !isInitialScrollPendingRef.current
      ) {
        return;
      }

      pendingLatestScrollRef.current = { reason, animated };
    },
    [],
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
          : fileType === 'image'
          ? await messageApi.uploadImage(uploadFile, {
              ...encrypted.fields,
              width: encrypted.metadata.width,
              height: encrypted.metadata.height,
            })
          : await messageApi.uploadAttachment(
              uploadFile,
              fileType,
              encrypted.fields,
            );
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
    const sessionSeq = chatSessionSeqRef.current;
    await messageApi.markAsRead(otherUserId);
    if (!isCurrentChatSession(sessionSeq)) {
      return;
    }
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
    isCurrentChatSession,
    markMatchingAsRead,
    otherUserId,
    refreshUnreadCount,
    signalChatDataChanged,
    user?.id,
  ]);

  const loadMessages = useCallback(
    async (mode: LoadMode = 'initial') => {
      const sessionSeq = chatSessionSeqRef.current;
      const requestSeq = ++loadMessagesSeqRef.current;
      loadMessagesAbortRef.current?.abort();
      const controller = new AbortController();
      loadMessagesAbortRef.current = controller;
      const showInitialLoading = mode === 'initial' && !hasLoadedRef.current;

      if (showInitialLoading) {
        setLoading(true);
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }

      setError(null);
      try {
        const response = await messageApi.getMessagesWith(
          otherUserId,
          {
            limit: MESSAGE_PAGE_SIZE,
          },
          {
            signal: controller.signal,
          },
        );
        const shouldInitialScroll =
          mode === 'initial' &&
          (!hasLoadedRef.current || messagesRef.current.length === 0);
        const displayMessages = await decryptChatMessages(response.messages);
        if (
          !isCurrentChatSession(sessionSeq) ||
          loadMessagesSeqRef.current !== requestSeq
        ) {
          return;
        }

        isInitialScrollPendingRef.current = shouldInitialScroll;
        pendingLatestScrollRef.current = null;
        if (shouldInitialScroll) {
          messageListMetricsRef.current = {
            ...messageListMetricsRef.current,
            contentHeight: 0,
            offsetY: 0,
          };
        }
        hasMoreRef.current = response.has_more;
        setHasMore(response.has_more);
        setMessages(previous =>
          mode === 'silent'
            ? mergeMessageLists(previous, displayMessages)
            : displayMessages,
        );

        if (shouldInitialScroll && displayMessages.length) {
          requestScrollToLatest('initial_load', false);
        } else if (shouldInitialScroll) {
          isInitialScrollPendingRef.current = false;
          isUserNearBottomRef.current = true;
        }

        markConversationRead().catch(() => undefined);
      } catch (apiError) {
        if ((apiError as Error)?.message === 'request aborted') {
          return;
        }
        if (
          isCurrentChatSession(sessionSeq) &&
          loadMessagesSeqRef.current === requestSeq
        ) {
          setError(getApiErrorMessage(apiError));
        }
      } finally {
        if (loadMessagesAbortRef.current === controller) {
          loadMessagesAbortRef.current = null;
        }
        if (
          isCurrentChatSession(sessionSeq) &&
          loadMessagesSeqRef.current === requestSeq
        ) {
          hasLoadedRef.current = true;
          setHasLoaded(true);
          if (showInitialLoading) {
            setLoading(false);
          }
          if (mode === 'refresh') {
            setRefreshing(false);
          }
        }
      }
    },
    [
      decryptChatMessages,
      hasMoreRef,
      isCurrentChatSession,
      messagesRef,
      markConversationRead,
      otherUserId,
      requestScrollToLatest,
    ],
  );

  const loadOlderMessages = useCallback(async () => {
    const sessionSeq = chatSessionSeqRef.current;
    const currentMessages = messagesRef.current;
    const oldestMessage = currentMessages[0];

    if (
      isLoadingOlderRef.current ||
      !hasMoreRef.current ||
      !oldestMessage ||
      isInitialScrollPendingRef.current ||
      pendingLatestScrollRef.current?.reason === 'initial_load' ||
      refreshing
    ) {
      return;
    }

    isLoadingOlderRef.current = true;
    pendingLatestScrollRef.current = null;
    setLoadingOlder(true);

    try {
      const response = await messageApi.getMessagesWith(otherUserId, {
        before: oldestMessage.id,
        limit: MESSAGE_PAGE_SIZE,
      });
      hasMoreRef.current = response.has_more;
      if (!isCurrentChatSession(sessionSeq)) {
        return;
      }
      setHasMore(response.has_more);

      if (response.messages.length) {
        const displayMessages = await decryptChatMessages(response.messages);
        if (!isCurrentChatSession(sessionSeq)) {
          return;
        }
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
      if (isCurrentChatSession(sessionSeq)) {
        setError(chatErrorMessage(apiError));
      }
    } finally {
      if (isCurrentChatSession(sessionSeq)) {
        isLoadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [
    decryptChatMessages,
    hasMoreRef,
    isCurrentChatSession,
    messagesRef,
    otherUserId,
    refreshing,
  ]);

  const handleMessagesScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      messageListMetricsRef.current = {
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      };

      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const nearBottom =
        contentSize.height <= layoutMeasurement.height ||
        distanceFromBottom <= NEAR_LATEST_THRESHOLD;
      isUserNearBottomRef.current = nearBottom;
      setShowScrollToLatest(!nearBottom && messagesRef.current.length > 0);
      if (nearBottom) {
        setNewMessagesBelow(false);
      }

      if (isInitialScrollPendingRef.current) {
        return;
      }

      if (contentOffset.y > LOAD_OLDER_THRESHOLD) {
        return;
      }

      loadOlderMessages().catch(() => undefined);
    },
    [loadOlderMessages, messagesRef],
  );

  const markMessageTouchStart = useCallback((event: GestureResponderEvent) => {
    lastMessageTouchTimestampRef.current = event.nativeEvent.timestamp;
  }, []);

  const handleMessageListTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      messageListTapRef.current = {
        startX: event.nativeEvent.pageX,
        startY: event.nativeEvent.pageY,
        startTimestamp: event.nativeEvent.timestamp,
        moved: false,
      };
    },
    [],
  );

  const handleMessageListTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const tap = messageListTapRef.current;
      if (tap.moved) {
        return;
      }

      const deltaX = Math.abs(event.nativeEvent.pageX - tap.startX);
      const deltaY = Math.abs(event.nativeEvent.pageY - tap.startY);
      if (
        deltaX > MESSAGE_LIST_TAP_MOVE_THRESHOLD ||
        deltaY > MESSAGE_LIST_TAP_MOVE_THRESHOLD
      ) {
        tap.moved = true;
      }
    },
    [],
  );

  const handleMessageListTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const tap = messageListTapRef.current;
      const messageHandledThisTap =
        lastMessageTouchTimestampRef.current >= tap.startTimestamp &&
        lastMessageTouchTimestampRef.current <= event.nativeEvent.timestamp;

      if (!tap.moved && !messageHandledThisTap) {
        Keyboard.dismiss();
      }
    },
    [],
  );

  const scrollToLatestFromButton = useCallback(() => {
    pendingLatestScrollRef.current = null;
    setShowScrollToLatest(false);
    setNewMessagesBelow(false);
    isUserNearBottomRef.current = true;
    scrollToLatestMessage(true);
  }, [scrollToLatestMessage]);

  const handleMessageListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      messageListMetricsRef.current = {
        ...messageListMetricsRef.current,
        layoutHeight: event.nativeEvent.layout.height,
      };

      const pending = pendingLatestScrollRef.current;
      if (pending && !isLoadingOlderRef.current) {
        scrollToLatestMessage(pending.animated);
        return;
      }

      if (
        hasLoadedRef.current &&
        isUserNearBottomRef.current &&
        !isLoadingOlderRef.current &&
        messagesRef.current.length > 0
      ) {
        scrollToLatestMessage(false);
      }
    },
    [messagesRef, scrollToLatestMessage],
  );

  const handleMessageListContentSizeChange = useCallback(
    (_contentWidth: number, contentHeight: number) => {
      const previousContentHeight =
        messageListMetricsRef.current.contentHeight;
      messageListMetricsRef.current = {
        ...messageListMetricsRef.current,
        contentHeight,
      };

      const pending = pendingLatestScrollRef.current;
      if (pending && !isLoadingOlderRef.current) {
        scrollToLatestMessage(pending.animated);
        return;
      }

      if (
        hasLoadedRef.current &&
        isUserNearBottomRef.current &&
        !isLoadingOlderRef.current &&
        contentHeight > previousContentHeight &&
        messagesRef.current.length > 0
      ) {
        scrollToLatestMessage(true);
      }
    },
    [messagesRef, scrollToLatestMessage],
  );

  const loadPinnedMessage = useCallback(async () => {
    const sessionSeq = chatSessionSeqRef.current;
    const requestSeq = ++loadPinnedSeqRef.current;
    loadPinnedAbortRef.current?.abort();
    const controller = new AbortController();
    loadPinnedAbortRef.current = controller;
    try {
      const pin = await messageApi.getPinnedMessage(otherUserId, {
        signal: controller.signal,
      });
      const displayPin = pin?.message
        ? {
            ...pin,
            message: await decryptIncomingMessage(pin.message),
          }
        : pin;
      if (
        !isCurrentChatSession(sessionSeq) ||
        loadPinnedSeqRef.current !== requestSeq
      ) {
        return;
      }
      setPinnedMessage(displayPin);
    } catch (apiError) {
      if ((apiError as Error)?.message === 'request aborted') {
        return;
      }
      if (
        isCurrentChatSession(sessionSeq) &&
        loadPinnedSeqRef.current === requestSeq
      ) {
        setPinnedMessage(null);
      }
    } finally {
      if (loadPinnedAbortRef.current === controller) {
        loadPinnedAbortRef.current = null;
      }
    }
  }, [decryptIncomingMessage, isCurrentChatSession, otherUserId]);

  useFocusEffect(
    useCallback(() => {
      loadMessages().catch(() => undefined);
      loadPinnedMessage().catch(() => undefined);
      return () => {
        loadMessagesAbortRef.current?.abort();
        loadMessagesAbortRef.current = null;
        loadPinnedAbortRef.current?.abort();
        loadPinnedAbortRef.current = null;
      };
    }, [loadMessages, loadPinnedMessage]),
  );

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }

      KeyboardController.setInputMode(
        AndroidSoftInputModes.SOFT_INPUT_ADJUST_RESIZE,
      );

      return () => {
        KeyboardController.setDefaultMode();
      };
    }, []),
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
    setPendingAttachments(draftRef.current.pendingAttachments);
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
        const belongsToChat = messageBelongsToChat(
          message,
          user?.id,
          otherUserId,
        );
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

        const sessionSeq = chatSessionSeqRef.current;
        decryptIncomingMessage(message)
          .then(displayMessage => {
            if (!isCurrentChatSession(sessionSeq)) {
              return;
            }
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

      if (event.type === WS_EVENTS.MESSAGE_REACTION) {
        const payload = event.payload as {
          message_id?: number;
          conversation_id?: number;
          reaction_version?: number;
          reactions?: Message['reactions'];
        };

        if (payload.conversation_id !== otherUserId || !payload.message_id) {
          return;
        }

        setMessages(previous =>
          previous.map(message => {
            if (message.id !== payload.message_id) {
              return message;
            }
            const currentVersion = message.reaction_version ?? 0;
            const nextVersion = payload.reaction_version ?? currentVersion;
            if (nextVersion < currentVersion) {
              return message;
            }
            return {
              ...message,
              reaction_version: nextVersion,
              reactions: payload.reactions ?? [],
            };
          }),
        );
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_PINNED) {
        const payload = event.payload as {
          pinned_message?: PinnedMessage | null;
        };
        const pinnedPayload = payload.pinned_message;
        if (!pinnedPayload) {
          setPinnedMessage(null);
          return;
        }
        if (
          !messageBelongsToChat(pinnedPayload.message, user?.id, otherUserId)
        ) {
          return;
        }
        const sessionSeq = chatSessionSeqRef.current;
        decryptIncomingMessage(pinnedPayload.message)
          .then(displayMessage => {
            if (!isCurrentChatSession(sessionSeq)) {
              return;
            }
            setPinnedMessage({
              ...pinnedPayload,
              message: displayMessage,
            });
          })
          .catch(() => undefined);
        return;
      }

      if (event.type === WS_EVENTS.MESSAGE_UNPINNED) {
        const payload = event.payload as {
          participant_ids?: number[];
        };
        if (
          user?.id &&
          payload.participant_ids?.includes(user.id) &&
          payload.participant_ids.includes(otherUserId)
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
      const belongsToChat = messageBelongsToChat(
        message,
        user?.id,
        otherUserId,
      );

      if (!belongsToChat) {
        return;
      }

      if (message.from_id === user?.id && message.to_id === otherUserId) {
        draftRef.current = null;
      }

      const sessionSeq = chatSessionSeqRef.current;
      decryptIncomingMessage(message)
        .then(displayMessage => {
          if (!isCurrentChatSession(sessionSeq)) {
            return;
          }
          if (
            messagesRef.current.some(item => item.id === displayMessage.id)
          ) {
            return;
          }
          if (displayMessage.from_id === user?.id) {
            requestScrollToLatest('own_message', true);
          } else if (isUserNearBottomRef.current) {
            requestScrollToLatest('incoming_message', true);
          } else {
            setShowScrollToLatest(true);
            setNewMessagesBelow(true);
          }
          setMessages(previous =>
            previous.some(item => item.id === displayMessage.id)
              ? previous
              : [...previous, displayMessage],
          );

          if (message.from_id === otherUserId) {
            markConversationRead().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    },
    [
      decryptIncomingMessage,
      isCurrentChatSession,
      markConversationRead,
      messagesRef,
      otherUserId,
      requestScrollToLatest,
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

  function validatePendingAttachment(attachment: PendingChatAttachment) {
    const extension = extensionFromFileName(attachment.fileName);
    if (
      extension &&
      (CHAT_BLOCKED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(
        extension,
      )
    ) {
      return 'Этот тип файла нельзя отправить';
    }

    if (attachment.fileType === 'image') {
      return validateLocalChatImage(attachment as LocalChatImage);
    }
    if (attachment.fileType === 'video') {
      return validateLocalChatVideo(attachment as LocalChatVideo);
    }
    return validateLocalChatFile(attachment as LocalChatFile);
  }

  function appendPendingAttachments(attachments: PendingChatAttachment[]) {
    if (attachments.length === 0) {
      setError('Не удалось подготовить вложение. Попробуйте еще раз.');
      return;
    }

    const current = pendingAttachmentsRef.current;
    if (current.length + attachments.length > CHAT_ATTACHMENT_MAX_COUNT) {
      setError(
        `Можно прикрепить максимум ${CHAT_ATTACHMENT_MAX_COUNT} файлов за раз`,
      );
      return;
    }

    const validationError = attachments
      .map(validatePendingAttachment)
      .find(Boolean);
    if (validationError) {
      setError(validationError);
      return;
    }

    const knownTotalSize = [...current, ...attachments].reduce(
      (total, attachment) => total + (attachment.fileSize || 0),
      0,
    );
    if (knownTotalSize > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      setError(
        `Вложения слишком большие. Максимум ${formatFileSize(
          CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
        )} на сообщение.`,
      );
      return;
    }

    setError(null);
    setPendingAttachments(previous => [...previous, ...attachments]);
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

    appendPendingAttachments(
      assets
        .map(assetToPendingAttachment)
        .filter(
          (attachment): attachment is PendingChatAttachment =>
            Boolean(attachment),
        ),
    );
  }

  async function pickMediaFromLibrary() {
    if (pendingVoiceRef.current || pendingVideoNoteRef.current) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }
    const remaining =
      CHAT_ATTACHMENT_MAX_COUNT - pendingAttachmentsRef.current.length;
    if (remaining <= 0) {
      setError(
        `Можно прикрепить максимум ${CHAT_ATTACHMENT_MAX_COUNT} файлов за раз`,
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

  async function pickFilesFromDevice() {
    if (pendingVoiceRef.current || pendingVideoNoteRef.current) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }
    const remaining =
      CHAT_ATTACHMENT_MAX_COUNT - pendingAttachmentsRef.current.length;
    if (remaining <= 0) {
      setError(
        `Можно прикрепить максимум ${CHAT_ATTACHMENT_MAX_COUNT} файлов за раз`,
      );
      return;
    }

    try {
      const files = await pickDocuments({
        mode: 'import',
        allowMultiSelection: remaining > 1,
        type: documentPickerMimeTypes,
      });
      appendPendingAttachments(
        files
          .slice(0, remaining)
          .map(documentToPendingAttachment)
          .filter(
            (attachment): attachment is PendingChatAttachment =>
              Boolean(attachment),
          ),
      );
    } catch (apiError) {
      if (
        isDocumentPickerErrorWithCode(apiError) &&
        apiError.code === documentPickerErrorCodes.OPERATION_CANCELED
      ) {
        return;
      }
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
    if (pendingVoiceRef.current || pendingVideoNoteRef.current) {
      setError('Сначала отправьте или удалите текущие вложения');
      return;
    }
    if (pendingAttachmentsRef.current.length >= CHAT_ATTACHMENT_MAX_COUNT) {
      setError(
        `Можно прикрепить максимум ${CHAT_ATTACHMENT_MAX_COUNT} файлов за раз`,
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
      pendingAttachmentsRef.current.length > 0 ||
      pendingVoiceRef.current ||
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
      type: 'audio/mp4',
      fileName: `voice-message-${Date.now()}.m4a`,
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
    if (sendingRef.current || messageActionPendingRef.current) {
      return false;
    }

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

    sendingRef.current = 'uploadingVoice';
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
        requestScrollToLatest('own_message', true);
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
      sendingRef.current = null;
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
      pendingAttachmentsRef.current.length > 0 ||
      pendingVoiceRef.current ||
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
    if (sendingRef.current || messageActionPendingRef.current) {
      return false;
    }

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
    sendingRef.current = 'uploadingVideoNote';
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
        requestScrollToLatest('own_message', true);
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
      sendingRef.current = null;
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
      sendingRef.current = 'sending';
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
        sendingRef.current = null;
        setMessageActionPending(false);
        setSending(null);
      }
      return;
    }

    if (!trimmed && pendingAttachments.length === 0) {
      setError('Введите сообщение или выберите вложение');
      return;
    }

    if (sendingRef.current || messageActionPendingRef.current) {
      return;
    }

    let uploadFailed = false;
    const hasPendingVideo = pendingAttachments.some(
      attachment => attachment.fileType === 'video',
    );
    const nextSendingState = hasPendingVideo
      ? 'preparingVideo'
      : pendingAttachments.length > 0
      ? 'uploading'
      : 'sending';
    sendingRef.current = nextSendingState;
    setSending(nextSendingState);
    setUploadProgress(
      pendingAttachments.length > 0
        ? {
            current: 0,
            total: pendingAttachments.length,
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
      for (const [index, pendingAttachment] of pendingAttachments.entries()) {
        try {
          if (pendingAttachment.fileType === 'video') {
            const compressedVideo = await compressLocalChatVideo(
              pendingAttachment as LocalChatVideo,
              stage => {
                setSending(
                  stage === 'compressing'
                    ? 'compressingVideo'
                    : 'preparingVideo',
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
          } else if (pendingAttachment.fileType === 'image') {
            setSending('uploading');
            attachments.push(
              e2eeReady
                ? await encryptAndUploadAttachment(
                    pendingAttachment,
                    'image',
                    otherUserId,
                  )
                : await messageApi.uploadImage(
                    pendingAttachment as LocalChatImage,
                  ),
            );
          } else {
            setSending('uploading');
            attachments.push(
              e2eeReady
                ? await encryptAndUploadAttachment(
                    pendingAttachment,
                    pendingAttachment.fileType,
                    otherUserId,
                  )
                : await messageApi.uploadAttachment(
                    pendingAttachment as LocalChatFile,
                    pendingAttachment.fileType,
                  ),
            );
          }
          setUploadProgress({
            current: index + 1,
            total: pendingAttachments.length,
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
        pendingAttachments,
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
        requestScrollToLatest('own_message', true);
        setMessages(previous => [...previous, displayMessage]);
        signalChatDataChanged();
      }

      setInput('');
      setInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
      setPendingAttachments([]);
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
      sendingRef.current = null;
      setSending(null);
      setUploadProgress(null);
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments(previous =>
      previous.filter(attachment => attachment.id !== id),
    );
  }

  const importLinkPreviewVideo = useCallback(
    async (message: Message) => {
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
    },
    [decryptIncomingMessage],
  );

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
      Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.ceil(contentHeight) + 10),
    );

    if (nextHeight === inputHeight) {
      return;
    }

    setInputHeight(nextHeight);

    if (isUserNearBottomRef.current) {
      requestAnimationFrame(() => {
        chatScrollViewRef.current?.scrollToEnd({ animated: false });
      });
    }
  }

  function handleComposerFocus() {
    if (!isUserNearBottomRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      chatScrollViewRef.current?.scrollToEnd({ animated: false });
    });
  }

  async function openComposerAttachments() {
    if (
      pendingVoiceRef.current ||
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
        text: 'Фото или видео из галереи',
        onPress: () => {
          pickMediaFromLibrary().catch(() => {
            setError('Не удалось выбрать файл. Попробуйте еще раз.');
          });
        },
      },
      {
        text: 'Выбрать файл',
        onPress: () => {
          pickFilesFromDevice().catch(() => {
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

  const handleDownloadAttachment = useCallback(
    async (attachment: MessageAttachment, sourceUrl?: string) => {
      try {
        const result = await downloadChatAttachment(attachment, sourceUrl);
        setError(null);
        setCopyNotice(
          result.status === 'queued'
            ? `Загрузка начата: ${result.fileName}`
            : `Файл сохранен: ${result.fileName}`,
        );
      } catch (downloadError) {
        setError(downloadAttachmentErrorMessage(downloadError));
      }
    },
    [],
  );

  async function downloadSelectedMessageAttachments(message: Message) {
    const attachments =
      message.attachments?.filter(isAttachmentDownloadable) ?? [];
    setSelectedMessage(null);

    if (attachments.length === 0) {
      setError('В этом сообщении нет доступных вложений.');
      return;
    }

    try {
      for (const attachment of attachments) {
        await downloadChatAttachment(attachment);
      }
      setError(null);
      setCopyNotice(
        attachments.length === 1
          ? 'Вложение скачано'
          : `Вложения скачаны: ${attachments.length}`,
      );
    } catch (downloadError) {
      setError(downloadAttachmentErrorMessage(downloadError));
    }
  }

  const toggleVoicePlayback = useCallback(async (url: string) => {
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
  }, [playingVoiceUrlRef, previewPlayingRef]);

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
    setPendingAttachments([]);
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
          requestScrollToLatest('own_message', true);
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
        requestScrollToLatest('own_message', true);
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

  const openMessageActions = useCallback((message: Message) => {
    setSelectedMessage(message);
  }, []);

  const trimmedInput = input.trim();
  const showComposerSendButton =
    Boolean(trimmedInput) ||
    Boolean(editingMessage) ||
    pendingAttachments.length > 0;
  const composerMediaIcon = composerMediaMode === 'voice' ? Mic : VideoIcon;
  const composerMediaLabel =
    composerMediaMode === 'voice'
      ? 'Микрофон. Нажмите, чтобы выбрать видео-сообщение, удерживайте для записи'
      : 'Видео-сообщение. Нажмите, чтобы выбрать микрофон, удерживайте для записи';
  const composerMediaDisabled =
    Boolean(sending) || Boolean(editingMessage) || recordingBusy;
  const messageKeyExtractor = useCallback(
    (item: Message) => String(item.id),
    [],
  );
  const renderMessageItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const nextMessage = messages[index + 1];
      const groupedWithNext = Boolean(
        nextMessage &&
          nextMessage.from_id === item.from_id &&
          new Date(nextMessage.created_at).toDateString() ===
            new Date(item.created_at).toDateString(),
      );

      return (
        <MessageBubble
          message={item}
          outgoing={item.from_id === user?.id}
          onImagePress={setSelectedImageUrl}
          onVideoPress={setSelectedVideoUrl}
          onImportLinkPreviewVideo={importLinkPreviewVideo}
          onVoicePress={toggleVoicePlayback}
          onDownloadAttachment={handleDownloadAttachment}
          playingVoiceUrl={playingVoiceUrl}
          onTouchStart={markMessageTouchStart}
          onLongPress={() => openMessageActions(item)}
          themeColors={themeColors}
          groupedWithNext={groupedWithNext}
        />
      );
    },
    [
      importLinkPreviewVideo,
      handleDownloadAttachment,
      markMessageTouchStart,
      messages,
      openMessageActions,
      playingVoiceUrl,
      themeColors,
      toggleVoicePlayback,
      user?.id,
    ],
  );

  return (
    <Screen
      scroll={false}
      padded={false}
      style={themed.chatBackground}
      contentContainerStyle={[styles.container, themed.chatBackground]}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={copyNotice} />

      <ChatDoodleBackground theme={themeColors}>
        <ChatPinnedMessageBar
          pinnedMessage={pinnedMessage}
          messages={messages}
          listRef={listRef}
          themed={themed}
          onUnpin={unpinCurrentMessage}
        />

        <KeyboardGestureArea
          interpolator="ios"
          offset={COMPOSER_INPUT_MIN_HEIGHT}
          style={styles.keyboardGestureArea}
          textInputNativeID={CHAT_INPUT_NATIVE_ID}
        >
          <ChatMessageList
            listRef={listRef}
            messages={messages}
            loading={loading}
            hasLoaded={hasLoaded}
            refreshing={refreshing}
            loadingOlder={loadingOlder}
            playingVoiceUrl={playingVoiceUrl}
            themeColors={themeColors}
            themed={themed}
            currentUserId={user?.id}
            messageListBottomPadding={messageListBottomPadding}
            scrollToLatestBottomOffset={scrollToLatestBottomOffset}
            showScrollToLatest={showScrollToLatest}
            newMessagesBelow={newMessagesBelow}
            renderScrollComponent={renderScrollComponent}
            renderMessageItem={renderMessageItem}
            keyExtractor={messageKeyExtractor}
            onRefresh={() => loadMessages('refresh')}
            onTouchStart={handleMessageListTouchStart}
            onTouchMove={handleMessageListTouchMove}
            onTouchEnd={handleMessageListTouchEnd}
            onScroll={handleMessagesScroll}
            onLayout={handleMessageListLayout}
            onContentSizeChange={handleMessageListContentSizeChange}
            onScrollToLatest={scrollToLatestFromButton}
          />
          <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
            <ChatComposerDock
              composerRef={composerRef}
              inputRef={composerInputRef}
              previewProgressBarRef={previewProgressBarRef}
              themed={themed}
              themeColors={themeColors}
              pendingAttachments={pendingAttachments}
              sending={sending}
              uploadProgress={uploadProgress}
              editingMessage={editingMessage}
              replyToMessage={replyToMessage}
              recording={recording}
              recordingSeconds={recordingSeconds}
              recordingBusy={recordingBusy}
              pendingVideoNote={pendingVideoNote}
              pendingVoice={pendingVoice}
              previewPlaying={previewPlaying}
              previewPosition={previewPosition}
              otherTyping={otherTyping}
              otherName={route.params.name}
              input={input}
              inputHeight={inputHeight}
              messageActionPending={messageActionPending}
              trimmedInput={trimmedInput}
              showComposerSendButton={showComposerSendButton}
              composerMediaIcon={composerMediaIcon}
              composerMediaLabel={composerMediaLabel}
              composerMediaDisabled={composerMediaDisabled}
              onLayout={handleComposerDockLayout}
              onRemovePendingAttachment={removePendingAttachment}
              onCancelEditing={cancelEditingMessage}
              onClearReply={() => setReplyToMessage(null)}
              onStopVoiceRecording={stopVoiceRecording}
              onDeletePendingVideoNote={() => setPendingVideoNote(null)}
              onSendPendingVideoNote={sendPendingVideoNote}
              onTogglePreviewPlayback={togglePreviewPlayback}
              onPreviewProgressPress={handlePreviewProgressPress}
              onDeletePendingVoice={deletePendingVoice}
              onSendPendingVoice={sendPendingVoice}
              onOpenAttachments={openComposerAttachments}
              onShowStickerNotice={showComposerStickerNotice}
              onInputChange={handleComposerTextChange}
              onInputFocus={handleComposerFocus}
              onInputContentSizeChange={handleComposerContentSizeChange}
              onSendMessage={sendMessage}
              onToggleComposerMediaMode={toggleComposerMediaMode}
              onStartComposerMediaRecording={startComposerMediaRecording}
              onStopComposerMediaRecording={stopComposerMediaRecording}
            />
          </KeyboardStickyView>
        </KeyboardGestureArea>
      </ChatDoodleBackground>
      <ChatLightboxes
        imageUrl={selectedImageUrl}
        videoUrl={selectedVideoUrl}
        onCloseImage={() => setSelectedImageUrl(null)}
        onCloseVideo={() => setSelectedVideoUrl(null)}
      />

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
        onDownloadAttachments={message => {
          downloadSelectedMessageAttachments(message).catch(() => undefined);
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
      <MiniProfileSheet
        visible={miniProfileVisible}
        userId={otherUserId}
        user={{ id: otherUserId, name: route.params.name }}
        onClose={() => setMiniProfileVisible(false)}
        onOpenProfile={(targetId, name) => {
          navigation.getParent()?.getParent()?.dispatch(
            CommonActions.navigate({
              name: 'UserProfile',
              params: { userId: targetId, name },
            }),
          );
        }}
      />
    </Screen>
  );
}
