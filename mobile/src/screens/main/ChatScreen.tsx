import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  FlatList,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import Sound, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import {
  assetURL,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
} from '../../config/env';
import { getApiErrorMessage, getCookieHeader } from '../../api/http';
import {
  messageApi,
  validateLocalChatImage,
  validateLocalVoiceMessage,
  type LocalChatImage,
  type LocalVoiceMessage,
} from '../../api/messages';
import type { Message, MessageAttachment } from '../../api/types';
import { chatSocket, type WsEvent } from '../../api/ws';
import { AppButton } from '../../components/AppButton';
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
import { colors } from '../../theme/colors';
import { formatDateTime, formatDuration } from '../../utils/format';
import type { ChatStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;
type LoadMode = 'initial' | 'refresh' | 'silent';
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
  const { startAudioCall, startVideoCall, status: callStatus } = useCall();
  const isFocused = useIsFocused();
  const { networkConnected, resumeCount } = useAppLifecycle();
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
  const voicePressStartXRef = useRef(0);
  const playingVoiceUrlRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(composerInputMinHeight);
  const [pendingImages, setPendingImages] = useState<LocalChatImage[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sending, setSending] = useState<
    'uploading' | 'uploadingVoice' | 'sending' | null
  >(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isVoiceCancelling, setIsVoiceCancelling] = useState(false);
  const [playingVoiceUrl, setPlayingVoiceUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const pendingImagesRef = useRef<LocalChatImage[]>([]);
  const sendingRef = useRef<'uploading' | 'uploadingVoice' | 'sending' | null>(null);
  const editingMessageRef = useRef<Message | null>(null);
  const recordingBusyRef = useRef<boolean>(false);
  const startVoiceRecordingRef = useRef<() => Promise<void> | void>(null as any);
  const stopVoiceRecordingRef = useRef<(send: boolean) => Promise<void> | void>(null as any);

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
    recordingBusyRef.current = recordingBusy;
  }, [recordingBusy]);

  useEffect(() => {
    return () => {
      if (recordingMaxTimerRef.current) {
        clearTimeout(recordingMaxTimerRef.current);
      }
      Sound.removeRecordBackListener();
      Sound.removePlaybackEndListener();
      Sound.stopPlayer().catch(() => undefined);
      Sound.stopRecorder().catch(() => undefined);
    };
  }, []);

  const voicePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        if (recordingActiveRef.current || recordingBusyRef.current || sendingRef.current || editingMessageRef.current) {
          return;
        }
        if (pendingImagesRef.current.length > 0) {
          setError('Сначала отправьте или удалите выбранные изображения');
          return;
        }
        voicePressStartXRef.current = evt.nativeEvent.pageX || 0;
        setIsVoiceCancelling(false);
        Promise.resolve((startVoiceRecordingRef.current || startVoiceRecording)()).catch(() => undefined);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (!recordingActiveRef.current) {
          return;
        }
        const leftDist = Math.max(0, -gestureState.dx);
        const cancelling = leftDist > 80;
        if (cancelling !== isVoiceCancelling) {
          setIsVoiceCancelling(cancelling);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const leftDist = Math.max(0, -gestureState.dx);
        const shouldSend = leftDist <= 80;
        Promise.resolve((stopVoiceRecordingRef.current || stopVoiceRecording)(shouldSend)).catch(() => undefined);
        setIsVoiceCancelling(false);
      },
      onPanResponderTerminate: () => {
        if (recordingActiveRef.current) {
          Promise.resolve((stopVoiceRecordingRef.current || stopVoiceRecording)(false)).catch(() => undefined);
        }
        setIsVoiceCancelling(false);
      },
    }),
  ).current;

  const scrollToLatestMessage = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: hasLoadedRef.current });
      shouldScrollToEndRef.current = false;
    });
  }, []);

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
        setMessages(response.messages);
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
    [markConversationRead, otherUserId],
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
        setMessages(previous => {
          const existingIds = new Set(previous.map(message => message.id));
          const olderMessages = response.messages.filter(
            message => !existingIds.has(message.id),
          );

          return olderMessages.length
            ? [...olderMessages, ...previous]
            : previous;
        });
      }
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [otherUserId, refreshing]);

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

  useFocusEffect(
    useCallback(() => {
      loadMessages().catch(() => undefined);
    }, [loadMessages]),
  );

  useEffect(() => {
    if (!isFocused || resumeCount === 0) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
  }, [isFocused, loadMessages, resumeCount]);

  useEffect(() => {
    if (!isFocused || !networkConnected) {
      return;
    }

    loadMessages('silent').catch(() => undefined);
  }, [isFocused, loadMessages, networkConnected]);

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
      if (event.type === 'message:error') {
        const payload = event.payload as { error: string };
        restoreDraftAfterSendError();
        setError(getApiErrorMessage(new Error(payload.error)));
        return;
      }

      if (event.type === 'message:read') {
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

      if (event.type === 'message:delete') {
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

      if (event.type === 'message:update') {
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

        setMessages(previous =>
          previous.map(item =>
            item.id === message.id && shouldApplyMessageUpdate(item, message)
              ? message
              : item,
          ),
        );
        signalChatDataChanged();
        return;
      }

      if (event.type !== 'message:new') {
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

      setMessages(previous => {
        if (previous.some(item => item.id === message.id)) {
          return previous;
        }
        shouldScrollToEndRef.current = true;
        return [...previous, message];
      });

      if (message.from_id === otherUserId) {
        markConversationRead().catch(() => undefined);
      }
    },
    [
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
        message: 'Разрешите доступ к микрофону, чтобы записывать голосовые сообщения.',
        buttonNegative: 'Отмена',
        buttonPositive: 'Разрешить',
      },
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  function clearRecordingLimitTimer() {
    if (recordingMaxTimerRef.current) {
      clearTimeout(recordingMaxTimerRef.current);
      recordingMaxTimerRef.current = null;
    }
  }

  async function startVoiceRecording() {
    if (recordingActiveRef.current || recordingBusyRef.current || sendingRef.current || editingMessageRef.current) {
      return;
    }
    if (pendingImagesRef.current.length > 0) {
      setError('Сначала отправьте или удалите выбранные изображения');
      return;
    }

    setRecordingBusy(true);
    setError(null);

    try {
      const permitted = await ensureRecordAudioPermission();
      if (!permitted) {
        setError('Разрешите доступ к микрофону, чтобы записать голосовое сообщение');
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
        Promise.resolve((stopVoiceRecordingRef.current || stopVoiceRecording)(true)).catch(() => undefined);
      }, CHAT_VOICE_MAX_DURATION_SECONDS * 1000);
    } catch (apiError) {
      Sound.removeRecordBackListener();
      setError(getApiErrorMessage(apiError));
      setIsVoiceCancelling(false);
    } finally {
      setRecordingBusy(false);
    }
  }

  async function stopVoiceRecording(send: boolean) {
    if (!recordingActiveRef.current || recordingBusy) {
      setIsVoiceCancelling(false);
      return;
    }

    setRecordingBusy(true);
    clearRecordingLimitTimer();
    Sound.removeRecordBackListener();

    let path = '';
    try {
      path = await Sound.stopRecorder();
    } catch (apiError) {
      if (send) {
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
    setRecording(false);
    setRecordingSeconds(0);
    setRecordingBusy(false);
    setIsVoiceCancelling(false);

    const shouldSend = send && durationSeconds >= 1;
    if (shouldSend && path) {
      await sendVoiceMessage(path, durationSeconds);
    }
  }

  startVoiceRecordingRef.current = startVoiceRecording;
  stopVoiceRecordingRef.current = stopVoiceRecording;

  async function sendVoiceMessage(path: string, durationSeconds: number) {
    const uri =
      path.startsWith('file://') || path.startsWith('content://')
        ? path
        : `file://${path}`;
    const voice: LocalVoiceMessage = {
      uri,
      type: CHAT_VOICE_MIME_TYPE,
      fileName: `voice-message-${Date.now()}.webm`,
      durationSeconds,
    };
    const validationError = validateLocalVoiceMessage(voice);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSending('uploadingVoice');
    setUploadProgress(null);
    setError(null);

    try {
      const attachment = await messageApi.uploadVoice(voice);
      const attachments = [attachment];

      setSending('sending');
      if (chatSocket.isConnected()) {
        chatSocket.sendMessage(otherUserId, '', attachments);
      } else {
        const sent = await messageApi.sendMessage(otherUserId, '', attachments);
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, sent]);
        signalChatDataChanged();
      }
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setSending(null);
      setUploadProgress(null);
    }
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
        const updated = await messageApi.updateMessage(
          editingMessage.id,
          trimmed,
        );
        setMessages(previous =>
          previous.map(message =>
            message.id === editingMessage.id &&
            shouldApplyMessageUpdate(message, updated)
              ? updated
              : message,
          ),
        );
        setInput('');
        setInputHeight(composerInputMinHeight);
        setEditingMessage(null);
        signalChatDataChanged();
      } catch (apiError) {
        setError(getApiErrorMessage(apiError));
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
      const attachments: MessageAttachment[] = [];
      for (const [index, image] of pendingImages.entries()) {
        try {
          attachments.push(await messageApi.uploadImage(image));
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
        chatSocket.sendMessage(otherUserId, trimmed, attachments);
      } else {
        const sent = await messageApi.sendMessage(
          otherUserId,
          trimmed,
          attachments,
        );
        draftRef.current = null;
        shouldScrollToEndRef.current = true;
        setMessages(previous => [...previous, sent]);
        signalChatDataChanged();
      }

      setInput('');
      setInputHeight(composerInputMinHeight);
      setPendingImages([]);
    } catch (apiError) {
      const message = getApiErrorMessage(apiError);
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

  function handleComposerTextChange(nextValue: string) {
    setInput(nextValue);

    if (!nextValue) {
      setInputHeight(composerInputMinHeight);
    }
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
  }

  function openMessageActions(message: Message) {
    const isOwnMessage = Boolean(user?.id && message.from_id === user.id);
    const hasCopyAction = Boolean(message.content.trim() || firstUrl(message.content));

    if (!isOwnMessage && !hasCopyAction) {
      return;
    }

    setSelectedMessage(message);
  }

  return (
    <Screen scroll={false} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />
      <SuccessBanner message={copyNotice} />

      <View style={styles.callActions}>
        <AppButton
          title="Аудио"
          variant="secondary"
          disabled={callStatus !== 'idle'}
          onPress={() => startAudioCall(otherUserId, route.params.name)}
        />
        <AppButton
          title="Видео"
          variant="secondary"
          disabled={callStatus !== 'idle'}
          onPress={() => startVideoCall(otherUserId, route.params.name)}
        />
      </View>

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
                <ActivityIndicator color={colors.accent} />
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
        <View style={styles.previewStrip}>
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
        <View style={styles.sendStatus}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.sendStatusText}>
            {sending === 'uploadingVoice'
              ? 'Загружаем голосовое сообщение'
              : sending === 'uploading'
              ? uploadProgress
                ? `Загружаем изображения: ${uploadProgress.current} из ${uploadProgress.total}`
                : 'Загружаем изображение'
              : 'Отправляем сообщение'}
          </Text>
        </View>
      ) : null}

      {editingMessage ? (
        <View style={styles.editingBar}>
          <View style={styles.editingInfo}>
            <Text style={styles.editingTitle}>Редактирование</Text>
            <Text style={styles.editingText} numberOfLines={1}>
              {editingMessage.content}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.editingCancel}
            onPress={cancelEditingMessage}
          >
            <Text style={styles.editingCancelText}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingTime}>{formatDuration(recordingSeconds)}</Text>
          <Text
            style={[
              styles.recordingText,
              isVoiceCancelling ? styles.recordingTextCancelling : null,
            ]}
            numberOfLines={1}
          >
            {isVoiceCancelling ? 'Отпустите, чтобы отменить' : 'Отпустите, чтобы отправить'}
          </Text>
          {!isVoiceCancelling && (
            <Text style={styles.recordingHint} numberOfLines={1}>
              Сдвиньте влево для отмены
            </Text>
          )}
        </View>
      ) : null}

      <View style={styles.composer}>
        <AppButton
          title="Фото"
          variant="secondary"
          disabled={Boolean(sending) || Boolean(editingMessage) || recording}
          onPress={pickImages}
        />
        <AppButton
          title="Голос"
          variant="secondary"
          disabled={Boolean(sending) || Boolean(editingMessage) || pendingImages.length > 0 || recordingBusy}
          onPress={() => {}}
          style={recording ? styles.voiceButtonRecording : undefined}
          {...voicePanResponder.panHandlers}
        />
        <TextInput
          value={input}
          onChangeText={handleComposerTextChange}
          onContentSizeChange={event =>
            handleComposerContentSizeChange(event.nativeEvent.contentSize.height)
          }
          placeholder="Сообщение"
          placeholderTextColor={colors.soft}
          multiline
          scrollEnabled={inputHeight >= composerInputMaxHeight}
          maxLength={1000}
          editable={!sending && !recording}
          textAlignVertical="top"
          style={[styles.input, { height: inputHeight }]}
        />
        <AppButton
          title={editingMessage ? 'Сохранить' : 'Отправить'}
          disabled={
            Boolean(sending) ||
            recording ||
            (!input.trim() && !editingMessage && pendingImages.length === 0)
          }
          loading={Boolean(sending)}
          onPress={sendMessage}
        />
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
        isOwn={Boolean(
          selectedMessage && user?.id && selectedMessage.from_id === user.id,
        )}
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
  };
}

function MessageBubble({
  message,
  outgoing,
  onImagePress,
  onVoicePress,
  playingVoiceUrl,
  onLongPress,
}: {
  message: Message;
  outgoing: boolean;
  onImagePress: (url: string) => void;
  onVoicePress: (url: string) => void;
  playingVoiceUrl: string | null;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}
      delayLongPress={280}
      onLongPress={onLongPress}
    >
      <View
        style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming]}
      >
        {message.content ? (
          <Text
            selectable
            style={[styles.messageText, outgoing && styles.outgoingText]}
          >
            {linkParts(message.content).map((part, index) => {
              if (part.type === 'link' && part.href) {
                return (
                  <Text
                    key={`${part.href}-${index}`}
                    style={[
                      styles.messageLink,
                      outgoing && styles.outgoingLink,
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
          const attachmentUrl = assetURL(attachment.file_url);

          if (attachment.file_type === 'voice') {
            const isPlaying = playingVoiceUrl === attachmentUrl;
            return (
              <Pressable
                key={attachment.id ?? attachment.file_url}
                accessibilityRole="button"
                style={[
                  styles.voiceAttachment,
                  outgoing && styles.voiceAttachmentOutgoing,
                ]}
                onPress={() => onVoicePress(attachmentUrl)}
                onLongPress={onLongPress}
              >
                <View
                  style={[
                    styles.voicePlayButton,
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
                      outgoing && styles.voiceTitleOutgoing,
                    ]}
                  >
                    Голосовое сообщение
                  </Text>
                  <Text
                    style={[
                      styles.voiceDuration,
                      outgoing && styles.voiceDurationOutgoing,
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

        <Text style={[styles.messageDate, outgoing && styles.outgoingDate]}>
          {formatDateTime(message.created_at)}
        </Text>
        {outgoing ? (
          <Text style={styles.outgoingStatus}>
            {message.is_read ? 'Прочитано' : 'Отправлено'}
          </Text>
        ) : null}
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
}: {
  message: Message | null;
  isOwn: boolean;
  onClose: () => void;
  onCopyText: (message: Message) => void;
  onCopyLink: (url: string) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
}) {
  const trimmedText = message?.content.trim() ?? '';
  const messageUrl = message ? firstUrl(message.content) : '';

  return (
    <Modal
      visible={Boolean(message)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Сообщение</Text>

          {message && isOwn && trimmedText ? (
            <Pressable
              accessibilityRole="button"
              style={styles.sheetAction}
              onPress={() => onEdit(message)}
            >
              <Text style={styles.sheetActionIcon}>E</Text>
              <Text style={styles.sheetActionText}>Редактировать</Text>
            </Pressable>
          ) : null}

          {message && isOwn ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.sheetAction, styles.sheetDangerAction]}
              onPress={() => onDelete(message)}
            >
              <Text style={[styles.sheetActionIcon, styles.sheetDangerIcon]}>
                D
              </Text>
              <Text style={[styles.sheetActionText, styles.sheetDangerText]}>
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
              <Text style={styles.sheetActionIcon}>T</Text>
              <Text style={styles.sheetActionText}>Скопировать текст</Text>
            </Pressable>
          ) : null}

          {messageUrl ? (
            <Pressable
              accessibilityRole="button"
              style={styles.sheetAction}
              onPress={() => onCopyLink(messageUrl)}
            >
              <Text style={styles.sheetActionIcon}>L</Text>
              <Text style={styles.sheetActionText}>Скопировать ссылку</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

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
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  messageList: {
    padding: 16,
    gap: 8,
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
    maxWidth: '82%',
    borderRadius: 14,
    padding: 10,
    gap: 6,
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
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  outgoingText: {
    color: '#ffffff',
  },
  messageLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  outgoingLink: {
    color: '#ffffff',
    textDecorationLine: 'underline',
  },
  messageDate: {
    color: colors.soft,
    fontSize: 11,
    alignSelf: 'flex-end',
  },
  outgoingDate: {
    color: 'rgba(255, 255, 255, 0.78)',
  },
  outgoingStatus: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 11,
    lineHeight: 14,
    alignSelf: 'flex-end',
  },
  messageImage: {
    width: 210,
    height: 150,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  voiceAttachment: {
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
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
    color: '#ffffff',
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
    color: '#ffffff',
  },
  voiceDuration: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  voiceDurationOutgoing: {
    color: 'rgba(255, 255, 255, 0.78)',
  },
  previewStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
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
    borderRadius: 10,
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
    color: '#ffffff',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
  },
  sendStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  sendStatusText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
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
    borderRadius: 17,
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
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: '#eff8ff',
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
  recordingHint: {
    color: colors.muted,
    fontSize: 11,
    marginLeft: 6,
  },
  recordingTextCancelling: {
    color: colors.danger,
    fontWeight: '700',
  },
  voiceButtonRecording: {
    backgroundColor: '#dc2626',
    opacity: 1,
  },
  recordingCancel: {
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  recordingCancelText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  recordingSend: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.accent,
  },
  recordingSendText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '600',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
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
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  sheetActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  sheetActionText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
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
