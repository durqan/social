import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import {
    ActivityIndicator,
    Modal,
    PanResponder,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    RotateCcw,
    Video,
    VideoOff,
    Volume2,
    VolumeOff,
} from 'lucide-react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';

import type { CallType } from '../api/ws';

type CallStatus =
    | 'idle'
    | 'incoming'
    | 'connecting'
    | 'ringing'
    | 'active'
    | 'reconnecting'
    | 'ended'
    | 'error';

type CallOverlayProps = {
    status: CallStatus;
    callType: CallType;
    peerName: string;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    microphoneOn: boolean;
    cameraOn: boolean;
    speakerphoneOn: boolean;
    frontCamera: boolean;
    error: string | null;
    onAccept: () => void;
    onReject: () => void;
    onEnd: () => void;
    onToggleMicrophone: () => void;
    onToggleCamera: () => void;
    onToggleSpeakerphone: () => void;
    onSwitchCamera: () => void;
};

function callStatusText(status: CallStatus, callType: CallType) {
    if (status === 'incoming') {
        return callType === 'video'
            ? 'Входящий видеозвонок'
            : 'Входящий звонок';
    }
    if (status === 'connecting') {
        return 'Соединяем звонок';
    }
    if (status === 'ringing') {
        return 'Ждем ответа';
    }
    if (status === 'active') {
        return callType === 'video' ? 'Видеозвонок идет' : 'Звонок идет';
    }
    if (status === 'reconnecting') {
        return 'Восстанавливаем соединение';
    }
    if (status === 'ended') {
        return 'Звонок завершен';
    }
    if (status === 'error') {
        return 'Не удалось выполнить звонок';
    }
    return '';
}

export function CallOverlay({
    status,
    callType,
    peerName,
    localStream,
    remoteStream,
    microphoneOn,
    cameraOn,
    speakerphoneOn,
    frontCamera,
    error,
    onAccept,
    onReject,
    onEnd,
    onToggleMicrophone,
    onToggleCamera,
    onToggleSpeakerphone,
    onSwitchCamera,
}: CallOverlayProps) {
    const insets = useSafeAreaInsets();
    const [chromeVisible, setChromeVisible] = useState(true);

    const isVideoCall = callType === 'video';

    const remoteVideoTrack = remoteStream
        ?.getVideoTracks()
        .find(track => track.readyState === 'live');

    const localVideoTrack = localStream
        ?.getVideoTracks()
        .find(track => track.readyState === 'live');

    const remoteStreamUrl = remoteStream?.toURL?.();
    const localStreamUrl = localStream?.toURL?.();

    const showRemoteVideo = Boolean(
        isVideoCall && remoteStream && remoteStreamUrl && remoteVideoTrack,
    );

    const showVideoPlaceholder = Boolean(isVideoCall && !remoteVideoTrack);

    const showLocalPreview = Boolean(
        isVideoCall && localStream && localStreamUrl && localVideoTrack,
    );

    const showActiveControls =
        status === 'connecting' ||
        status === 'ringing' ||
        status === 'active' ||
        status === 'reconnecting';

    const initial = peerName.slice(0, 1).toUpperCase();

    const showSpinner =
        status === 'connecting' ||
        status === 'ringing' ||
        status === 'reconnecting';

    const shouldAutoHideChrome =
        isVideoCall && showActiveControls && status === 'active';

    useEffect(() => {
        setChromeVisible(true);
    }, [status, callType, remoteStreamUrl]);

    useEffect(() => {
        if (!shouldAutoHideChrome || !chromeVisible) {
            return;
        }

        const timer = setTimeout(() => {
            setChromeVisible(false);
        }, 2600);

        return () => clearTimeout(timer);
    }, [shouldAutoHideChrome, chromeVisible]);

    const toggleChrome = useCallback(() => {
        setChromeVisible(current => !current);
    }, []);

    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_, gesture) => {
                    const verticalMove = Math.abs(gesture.dy) > 28;
                    const mostlyVertical =
                        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.4;

                    return verticalMove && mostlyVertical;
                },
                onPanResponderRelease: (_, gesture) => {
                    if (
                        showActiveControls &&
                        gesture.dy > 140 &&
                        Math.abs(gesture.dx) < 90
                    ) {
                        onEnd();
                    }
                },
            }),
        [onEnd, showActiveControls],
    );

    if (status === 'idle') {
        return null;
    }

    return (
        <Modal
            visible
            animationType="fade"
            presentationStyle="fullScreen"
            statusBarTranslucent
            navigationBarTranslucent
        >
            <StatusBar hidden animated />

            <View style={styles.callRoot}>
                <Pressable
                    style={styles.remoteStage}
                    onPress={toggleChrome}
                    {...panResponder.panHandlers}
                >
                    {showRemoteVideo && remoteStreamUrl ? (
                        <RTCView
                            key={remoteStreamUrl}
                            streamURL={remoteStreamUrl}
                            style={styles.remoteVideo}
                            objectFit="cover"
                            zOrder={0}
                        />
                    ) : null}

                    {showVideoPlaceholder ? (
                        <View style={styles.videoPlaceholder}>
                            {showSpinner ? (
                                <ActivityIndicator
                                    color="#ffffff"
                                    size="small"
                                />
                            ) : null}
                        </View>
                    ) : null}

                    {!isVideoCall ? (
                        <View style={styles.audioStage}>
                            <View style={styles.avatarPulse} />

                            <View style={styles.peerAvatar}>
                                <Text style={styles.peerInitial}>
                                    {initial}
                                </Text>
                            </View>

                            {showSpinner ? (
                                <ActivityIndicator
                                    color="#ffffff"
                                    size="large"
                                />
                            ) : null}
                        </View>
                    ) : null}
                </Pressable>

                {chromeVisible ? (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.callHeader,
                            { top: Math.max(insets.top, 12) + 12 },
                        ]}
                    >
                        <Text style={styles.callName} numberOfLines={1}>
                            {peerName}
                        </Text>

                        <Text style={styles.callStatus}>
                            {error ?? callStatusText(status, callType)}
                        </Text>
                    </View>
                ) : null}

                {showLocalPreview && localStreamUrl ? (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.localPreview,
                            {
                                top: chromeVisible
                                    ? Math.max(insets.top, 12) + 86
                                    : Math.max(insets.top, 12) + 18,
                            },
                        ]}
                    >
                        <RTCView
                            key={localStreamUrl}
                            streamURL={localStreamUrl}
                            style={styles.localVideo}
                            mirror={frontCamera}
                            objectFit="cover"
                            zOrder={1}
                        />
                    </View>
                ) : null}

                {chromeVisible ? (
                    <View
                        style={[
                            styles.callControls,
                            { bottom: Math.max(insets.bottom, 10) + 10 },
                        ]}
                    >
                        {status === 'incoming' ? (
                            <View style={styles.incomingControlsRow}>
                                <CallButton
                                    label="Отклонить"
                                    icon={PhoneOff}
                                    danger
                                    large
                                    onPress={onReject}
                                />

                                <CallButton
                                    label="Ответить"
                                    icon={Phone}
                                    accept
                                    large
                                    onPress={onAccept}
                                />
                            </View>
                        ) : null}

                        {showActiveControls ? (
                            <View style={styles.callButtonsRow}>
                                <CallButton
                                    label={microphoneOn ? 'Микрофон' : 'Выкл.'}
                                    icon={microphoneOn ? Mic : MicOff}
                                    muted={!microphoneOn}
                                    onPress={onToggleMicrophone}
                                />

                                {callType === 'audio' ? (
                                    <CallButton
                                        label={
                                            speakerphoneOn
                                                ? 'Динамик'
                                                : 'Телефон'
                                        }
                                        icon={
                                            speakerphoneOn
                                                ? Volume2
                                                : VolumeOff
                                        }
                                        muted={!speakerphoneOn}
                                        onPress={onToggleSpeakerphone}
                                    />
                                ) : null}

                                {callType === 'video' ? (
                                    <>
                                        <CallButton
                                            label={
                                                cameraOn ? 'Камера' : 'Выкл.'
                                            }
                                            icon={cameraOn ? Video : VideoOff}
                                            muted={!cameraOn}
                                            onPress={onToggleCamera}
                                        />

                                        <CallButton
                                            label="Сменить"
                                            icon={RotateCcw}
                                            onPress={onSwitchCamera}
                                        />
                                    </>
                                ) : null}

                                <CallButton
                                    label="Завершить"
                                    icon={PhoneOff}
                                    danger
                                    onPress={onEnd}
                                />
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

function CallButton({
    label,
    icon: Icon,
    danger,
    accept,
    muted,
    large,
    onPress,
}: {
    label: string;
    icon: React.ComponentType<{
        color?: string;
        size?: number;
        strokeWidth?: number;
    }>;
    danger?: boolean;
    accept?: boolean;
    muted?: boolean;
    large?: boolean;
    onPress: () => void;
}) {
    const iconColor = danger || accept || muted ? '#ffffff' : '#0f172a';

    return (
        <View style={styles.callButtonWrap}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                    styles.callButton,
                    large && styles.callButtonLarge,
                    danger && styles.callButtonDanger,
                    accept && styles.callButtonAccept,
                    muted && styles.callButtonMuted,
                    pressed && styles.callButtonPressed,
                ]}
                onPress={onPress}
            >
                <Icon
                    color={iconColor}
                    size={large ? 30 : 23}
                    strokeWidth={2.5}
                />
            </Pressable>
            <Text style={styles.callButtonText}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    callRoot: {
        flex: 1,
        backgroundColor: '#050713',
        overflow: 'hidden',
    },
    remoteStage: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#050713',
        overflow: 'hidden',
    },
    remoteVideo: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    videoPlaceholder: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        backgroundColor: '#050713',
    },
    videoPlaceholderText: {
        color: '#f8fafc',
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '800',
        textAlign: 'center',
    },
    audioStage: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        backgroundColor: '#050713',
    },
    avatarPulse: {
        position: 'absolute',
        width: 190,
        height: 190,
        borderRadius: 95,
        backgroundColor: 'rgba(124, 92, 255, 0.18)',
    },
    peerAvatar: {
        width: 132,
        height: 132,
        borderRadius: 66,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#7c5cff',
        borderWidth: 10,
        borderColor: 'rgba(255,255,255,0.18)',
        shadowColor: '#7c5cff',
        shadowOpacity: 0.52,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: 16 },
        elevation: 8,
    },
    peerInitial: {
        color: '#ffffff',
        fontSize: 58,
        lineHeight: 70,
        fontWeight: '900',
        textAlign: 'center',
    },
    callHeader: {
        position: 'absolute',
        zIndex: 30,
        elevation: 30,
        left: 24,
        right: 24,
        alignItems: 'center',
        gap: 7,
    },
    callName: {
        color: '#ffffff',
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '900',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 8,
    },
    callStatus: {
        color: 'rgba(255,255,255,0.82)',
        fontSize: 15,
        lineHeight: 20,
        fontWeight: '600',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
    },
    callHint: {
        marginTop: 2,
        color: 'rgba(255,255,255,0.48)',
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
        textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
    },
    localPreview: {
        position: 'absolute',
        right: 16,
        width: 122,
        height: 172,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.86)',
        borderRadius: 18,
        backgroundColor: '#0f172a',
        shadowColor: '#000000',
        shadowOpacity: 0.32,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        zIndex: 25,
        elevation: 25,
    },
    localVideo: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    callControls: {
        position: 'absolute',
        left: 14,
        right: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 24,
        backgroundColor: 'rgba(13,16,33,0.84)',
        borderWidth: 1,
        borderColor: 'rgba(135,117,255,0.24)',
        shadowColor: '#000000',
        shadowOpacity: 0.3,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        zIndex: 35,
        elevation: 35,
    },
    incomingControlsRow: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
    },
    callButtonsRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-evenly',
        gap: 10,
    },
    callButtonWrap: {
        alignItems: 'center',
        gap: 6,
        minWidth: 64,
    },
    callButton: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.16)',
    },
    callButtonLarge: {
        width: 66,
        height: 66,
        borderRadius: 33,
    },
    callButtonDanger: {
        backgroundColor: '#ef4444',
        borderColor: '#ef4444',
    },
    callButtonAccept: {
        backgroundColor: '#27d58a',
        borderColor: '#27d58a',
    },
    callButtonMuted: {
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderColor: 'rgba(255,255,255,0.18)',
    },
    callButtonPressed: {
        opacity: 0.78,
        transform: [{ scale: 0.96 }],
    },
    callButtonText: {
        color: '#ffffff',
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '800',
        textAlign: 'center',
    },
});
