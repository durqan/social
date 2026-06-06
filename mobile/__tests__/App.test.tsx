/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@preeternal/react-native-cookie-manager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({})),
    clearAll: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() =>
      Promise.resolve({
        isConnected: true,
        isInternetReachable: true,
      }),
    ),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@react-native-firebase/messaging', () => {
  const mockMessaging = {
    AuthorizationStatus: {
      AUTHORIZED: 1,
      PROVISIONAL: 2,
    },
    registerDeviceForRemoteMessages: jest.fn(() => Promise.resolve()),
    requestPermission: jest.fn(() => Promise.resolve(1)),
    getToken: jest.fn(() => Promise.resolve('test-fcm-token')),
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
    setBackgroundMessageHandler: jest.fn(),
  };

  return {
    __esModule: true,
    default: Object.assign(() => mockMessaging, {
      AuthorizationStatus: mockMessaging.AuthorizationStatus,
    }),
  };
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
  launchCamera: jest.fn(),
}));

jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    setSubscriptionDuration: jest.fn(),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
    addPlaybackEndListener: jest.fn(),
    removePlaybackEndListener: jest.fn(),
    startRecorder: jest.fn(() => Promise.resolve('file:///tmp/voice.webm')),
    stopRecorder: jest.fn(() => Promise.resolve('file:///tmp/voice.webm')),
    startPlayer: jest.fn(() => Promise.resolve('started')),
    stopPlayer: jest.fn(() => Promise.resolve('stopped')),
  },
  AudioSourceAndroidType: {
    MIC: 1,
  },
  OutputFormatAndroidType: {
    WEBM: 9,
  },
  AudioEncoderAndroidType: {
    VORBIS: 6,
  },
}));

jest.mock('react-native-webrtc', () => {
  class MockMediaStream {
    getTracks() {
      return [];
    }
    getAudioTracks() {
      return [];
    }
    getVideoTracks() {
      return [];
    }
    toURL() {
      return 'mock-stream';
    }
    release() {}
  }

  class MockRTCPeerConnection {
    connectionState = 'new';
    remoteDescription = null;
    addEventListener = jest.fn();
    addTrack = jest.fn();
    createOffer = jest.fn(() =>
      Promise.resolve({ type: 'offer', sdp: 'offer-sdp' }),
    );
    createAnswer = jest.fn(() =>
      Promise.resolve({ type: 'answer', sdp: 'answer-sdp' }),
    );
    setLocalDescription = jest.fn(() => Promise.resolve());
    setRemoteDescription = jest.fn(() => Promise.resolve());
    addIceCandidate = jest.fn(() => Promise.resolve());
    close = jest.fn();
  }

  return {
    mediaDevices: {
      getUserMedia: jest.fn(() => Promise.resolve(new MockMediaStream())),
    },
    RTCPeerConnection: MockRTCPeerConnection,
    RTCSessionDescription: jest.fn(value => value),
    RTCIceCandidate: jest.fn(value => value),
    RTCView: 'RTCView',
  };
});

jest.mock('react-native-screens', () => ({
  ...jest.requireActual('react-native-screens'),
  enableScreens: jest.fn(),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
