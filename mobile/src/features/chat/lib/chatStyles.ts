import { StyleSheet } from 'react-native';

import { colors } from '../../../theme/colors';
import { radius, spacing, typography } from '../../../theme/layout';
import type { ThemeColors } from '../../../theme/themes';

export const createChatThemeStyles = (theme: ThemeColors = colors) => {
  const isPremium = theme.id === 'mono-premium';
  const isWarm = theme.id === 'warm-linen';

  const ownBubbleBg = theme.messageOwnBg;
  const ownBubbleText = theme.messageOwnText;
  const otherBubbleBg = theme.messageOtherBg;
  const otherBubbleText = theme.messageOtherText;
  const otherBubbleBorder = theme.isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.messageOtherBorder;

  const glassSurface = theme.isDark
    ? isPremium
      ? 'rgba(17,19,21,0.92)'
      : 'rgba(20,18,42,0.88)'
    : isWarm
    ? 'rgba(255,250,243,0.94)'
    : 'rgba(255,255,255,0.88)';

  const glassMuted = theme.isDark
    ? isPremium
      ? 'rgba(255,255,255,0.055)'
      : 'rgba(255,255,255,0.075)'
    : isWarm
    ? 'rgba(255,246,236,0.86)'
    : 'rgba(246,248,255,0.86)';

  return StyleSheet.create({
    chatBackground: {
      backgroundColor: theme.background,
    },
    card: {
      backgroundColor: glassSurface,
      borderColor: theme.border,
      shadowColor: theme.shadow,
    },
    cardMuted: {
      backgroundColor: glassMuted,
      borderColor: theme.border,
    },
    surfaceBar: {
      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.72)',
      borderColor: theme.border,
      borderTopColor: theme.border,
    },
    composerDock: {
      backgroundColor: 'transparent',
      borderTopColor: 'transparent',
      zIndex: 30,
    },
    composerSurface: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    composerSideButton: {
      backgroundColor: theme.isDark
        ? 'rgba(20,20,24,0.72)'
        : 'rgba(255,255,255,0.72)',
      borderColor: 'transparent',
    },
    composerInputContainer: {
      backgroundColor: theme.isDark
        ? 'rgba(20,20,24,0.72)'
        : 'rgba(255,255,255,0.72)',
      borderColor: 'transparent',
    },
    composerEmojiButton: {
      backgroundColor: 'transparent',
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
      color: otherBubbleText,
    },
    messageBodyText: {
      fontSize: 14,
      lineHeight: 19,
    },
    outgoingMessageText: {
      color: ownBubbleText,
    },
    composerInputText: {
      fontSize: 15,
      lineHeight: 20,
      color: theme.text,
    },
    outgoingAccentText: {
      color: ownBubbleText,
      opacity: 0.94,
    },
    outgoingMutedText: {
      color: ownBubbleText,
      opacity: 0.8,
    },
    outgoingSoftText: {
      color: ownBubbleText,
      opacity: 0.7,
    },
    outgoingLink: {
      color: ownBubbleText,
      textDecorationLine: 'underline',
    },
    mutedText: {
      color: theme.muted,
    },
    softText: {
      color: theme.soft,
    },
    accentText: {
      color: theme.accentStrong,
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
      backgroundColor: otherBubbleBg,
      borderColor: otherBubbleBorder,
      shadowColor: theme.shadow,
      shadowOpacity: theme.isDark ? 0.22 : 0.08,
    },
    outgoingBubble: {
      backgroundColor: ownBubbleBg,
      borderColor: theme.messageOwnBorder,
      borderWidth: StyleSheet.hairlineWidth,
      shadowColor: theme.shadow,
      shadowOpacity: theme.isDark ? 0.22 : 0.08,
    },
    replyPreview: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : theme.surfaceMuted,
      borderLeftColor: theme.accent,
    },
    voiceAttachment: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : theme.surfaceMuted,
    },
    genericVideoAttachment: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : theme.surfaceMuted,
    },
    genericFileAttachment: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : theme.surfaceMuted,
    },
    messageImageFrame: {
      backgroundColor: theme.surfaceMuted,
    },
    messageImage: {
      backgroundColor: theme.surfaceMuted,
    },
    videoNoteAttachment: {
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
        ? 'rgba(255,255,255,0.34)'
        : 'rgba(255,255,255,0.72)',
    },
    videoNotePill: {
      backgroundColor: theme.isDark
        ? 'rgba(2,6,23,0.68)'
        : 'rgba(15,23,42,0.56)',
    },
    videoNotePillProgress: {
      backgroundColor: theme.accentSoft,
    },
    previewStrip: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    previewFileTile: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
    },
    previewVideoCard: {
      backgroundColor: glassSurface,
      borderColor: theme.border,
    },
    previewVideoNoteCard: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
    },
    previewVoiceCard: {
      backgroundColor: theme.surfaceMuted,
      borderColor: theme.border,
    },
    previewProgressBar: {
      backgroundColor: theme.border,
    },
    previewProgressFill: {
      backgroundColor: theme.accent,
    },
    linkPreviewCard: {
      backgroundColor: theme.isDark
        ? isPremium
          ? 'rgba(255,255,255,0.075)'
          : 'rgba(255,255,255,0.09)'
        : 'rgba(255,255,255,0.94)',
      borderColor: theme.isDark
        ? 'rgba(255,255,255,0.12)'
        : 'rgba(17,24,39,0.10)',
      borderWidth: StyleSheet.hairlineWidth,
    },
    linkPreviewThumb: {
      backgroundColor: theme.isDark
        ? 'rgba(255,255,255,0.08)'
        : 'rgba(15,23,42,0.08)',
    },
    linkPreviewProvider: {
      color: theme.muted,
    },
    linkPreviewTitle: {
      color: theme.text,
    },
    linkPreviewUrl: {
      color: theme.muted,
    },
    linkPreviewStatus: {
      color: theme.soft,
    },
    linkPreviewFailed: {
      color: theme.danger,
    },
    linkPreviewButton: {
      backgroundColor: theme.accent,
    },
    linkPreviewButtonText: {
      color: theme.white,
    },
    linkPreviewSecondaryButton: {
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    linkPreviewSecondaryText: {
      color: theme.text,
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
    scrollToLatestButton: {
      backgroundColor: glassSurface,
      borderColor: theme.border,
      shadowColor: theme.shadow,
    },
    scrollToLatestButtonNew: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
  });
};

export type ChatThemeStyles = ReturnType<typeof createChatThemeStyles>;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
    position: 'relative',
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
  chatHeaderTitleButton: {
    flexShrink: 1,
    maxWidth: 220,
    minWidth: 0,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 6,
  },
  chatHeaderTitleText: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  messageListContainer: {
    flex: 1,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  messageListFrame: {
    flex: 1,
  },
  transparentBackground: {
    backgroundColor: 'transparent',
  },
  keyboardGestureArea: {
    flex: 1,
  },
  callActions: {
    display: 'none',
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  emptyMessageList: {
    justifyContent: 'center',
  },
  scrollToLatestButton: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: colors.isDark ? 0.16 : 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: colors.isDark ? 2 : 6,
    zIndex: 40,
  },
  scrollToLatestButtonNew: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  scrollToLatestText: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bubbleRowSpacing: {
    marginBottom: 7,
  },
  bubbleRowGroupedSpacing: {
    marginBottom: 3,
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    minWidth: 74,
    borderRadius: 22,
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 8,
    gap: spacing.xs,
    position: 'relative',
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  bubbleWithFloatingFooter: {
    paddingBottom: 16,
  },

  messageInlineFooter: {
    fontSize: 10,
    lineHeight: 12,
  },

  messageFooterTime: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '500',
  },

  messageFooterChecks: {
    marginLeft: 1,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
  },
  messageFooter: {
    position: 'absolute',
    right: 9,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  incoming: {
    backgroundColor: colors.messageOtherBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.messageOtherBorder,
    borderBottomLeftRadius: 7,
  },
  outgoing: {
    backgroundColor: colors.messageOwnBg,
    borderBottomRightRadius: 7,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.1,
    color: colors.text,
  },
  messageFooterMeasure: {
    opacity: 0,
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
    borderRadius: 16,
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
    marginTop: 1,
  },
  outgoingDate: {
    color: colors.muted,
  },
  outgoingStatus: {
    color: colors.accent,
    ...typography.tiny,
    alignSelf: 'flex-end',
  },
  messageImage: {
    maxWidth: '100%',
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  messageImageFrame: {
    maxWidth: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  attachmentDownloadButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.58)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  attachmentDownloadButtonFloating: {
    position: 'absolute',
    right: 6,
    top: 6,
  },
  genericVideoAttachment: {
    maxWidth: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  genericVideo: {
    width: '100%',
    aspectRatio: 236 / 156,
    backgroundColor: '#000',
  },
  genericVideoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  genericVideoPlay: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  genericVideoPlayText: {
    color: colors.white,
    fontSize: 18,
    marginLeft: 2,
  },
  genericAttachmentMeta: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 12,
  },
  linkPreviewCard: {
    marginTop: spacing.sm,
    maxWidth: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    padding: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  linkPreviewThumb: {
    width: '100%',
    aspectRatio: 220 / 112,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  linkPreviewThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkPreviewProvider: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.muted,
  },
  linkPreviewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  linkPreviewUrl: {
    fontSize: 12,
    color: colors.muted,
  },
  linkPreviewStatus: {
    fontSize: 12,
    color: colors.soft,
  },
  linkPreviewFailed: {
    color: colors.danger,
    fontSize: 12,
  },
  linkPreviewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  linkPreviewButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accent,
  },
  linkPreviewButtonDisabled: {
    opacity: 0.6,
  },
  linkPreviewButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  linkPreviewSecondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  linkPreviewSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  genericFileAttachment: {
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  genericFileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  genericFileIconText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '800',
  },
  attachmentDecryptError: {
    borderRadius: radius.lg,
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
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  voiceAttachmentOutgoing: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  voicePlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    maxWidth: '100%',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    backgroundColor: colors.surfaceMuted,
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
  videoNotePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  videoNoteGlassButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
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
    marginHorizontal: 2,
    marginBottom: spacing.xs,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  previewStripContent: {
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  previewItem: {
    width: 72,
    height: 72,
  },
  previewImage: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  previewFileItem: {
    width: 184,
  },
  previewVideoTile: {
    width: 72,
    height: 72,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  previewVideoThumbnail: {
    width: 72,
    height: 72,
    backgroundColor: '#000',
  },
  previewVideoBadge: {
    position: 'absolute',
    left: 20,
    top: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.58)',
  },
  previewFileTile: {
    width: 184,
    height: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingRight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  previewFileIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  previewFileMeta: {
    flex: 1,
    minWidth: 0,
  },
  previewFileName: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  previewFileDetail: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  previewVideoCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 88,
    borderRadius: 22,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewVideo: {
    width: 96,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: '#000',
  },
  previewVideoMeta: {
    flex: 1,
    minWidth: 0,
    paddingRight: 30,
  },
  previewVideoTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  previewVideoSubtitle: {
    marginTop: 3,
    fontSize: 12,
  },
  previewRemove: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  previewRemoveText: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.danger,
    color: colors.white,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 6,
    borderRadius: 22,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 2,
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
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    borderRadius: 18,
    borderTopWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sendStatusText: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: colors.isDark ? 0.24 : 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: colors.isDark ? 1 : 2,
  },
  replyInfo: {
    flex: 1,
    minWidth: 0,
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
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: colors.isDark ? 0.24 : 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: colors.isDark ? 1 : 2,
  },
  editingInfo: {
    flex: 1,
    minWidth: 0,
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
    width: 44,
    height: 44,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  recordingCancel: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.xl,
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
  previewVoiceCard: {
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.xl,
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
    paddingLeft: 54,
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
    paddingLeft: 54,
    paddingTop: 4,
  },
  typingBar: {
    marginHorizontal: 2,
    marginBottom: spacing.sm,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typingText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    backgroundColor: 'transparent',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'transparent',
    elevation: 0,
  },
  composerSideButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 0,
    borderColor: 'transparent',
    marginBottom: 0,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  composerInputContainer: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 22,
    paddingLeft: 12,
    paddingRight: 2,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  composerBlur: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 22,
  },

  composerGlassTint: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },

  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    zIndex: 2,
  },

  composerEmojiButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
    zIndex: 2,
  },
  composerButtonPressed: {
    opacity: 0.72,
  },
  composerButtonDisabled: {
    opacity: 0.42,
  },
  composerActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginBottom: 0,
  },
  composerActionRecording: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
    opacity: 1,
  },
  lightbox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 0,
  },
  lightboxBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  lightboxImage: {
    flex: 1,
    width: '100%',
  },
  lightboxVideo: {
    flex: 1,
    width: '100%',
  },
  lightboxVideoError: {
    position: 'absolute',
    left: 28,
    right: 28,
    top: '45%',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
  },
  lightboxVideoErrorText: {
    color: colors.white,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
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
    backgroundColor: colors.overlay,
  },
  sheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 6,
    shadowColor: colors.shadow,
    shadowOpacity: colors.isDark ? 0 : 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -12 },
    elevation: colors.isDark ? 0 : 8,
    overflow: 'hidden',
  },
  sheetScrollable: {
    overflow: 'hidden',
    paddingBottom: 0,
  },
  sheetScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  sheetActionList: {
    gap: 6,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
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
    gap: spacing.md,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cardMuted,
  },
  sheetActionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    flexShrink: 0,
  },
  sheetActionText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typography.body,
    fontWeight: '600',
  },
  forwardPreview: {
    borderRadius: radius.lg,
    padding: spacing.md,
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
    flexShrink: 1,
  },
  forwardListContent: {
    gap: 6,
  },
  forwardRecipient: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  forwardRecipientSelected: {
    borderColor: colors.accent,
  },
  forwardRecipientName: {
    flex: 1,
    minWidth: 0,
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forwardCheckSelected: {
    backgroundColor: colors.accent,
  },
  forwardActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
  },
  forwardButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  forwardButtonDisabled: {
    opacity: 0.46,
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
