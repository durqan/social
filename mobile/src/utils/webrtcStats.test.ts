import {
  collectWebRTCDiagnostics,
  createCallStatsAccumulator,
} from './webrtcStats';

function statsSample(timestamp: number, sentBytes: number, receivedBytes: number) {
  return new Map<string, object>([
    [
      'codec-out',
      {
        id: 'codec-out',
        type: 'codec',
        mimeType: 'video/H264',
        sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1',
      },
    ],
    [
      'codec-in',
      {
        id: 'codec-in',
        type: 'codec',
        mimeType: 'video/VP8',
      },
    ],
    [
      'outbound',
      {
        id: 'outbound',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp,
        codecId: 'codec-out',
        remoteId: 'remote-inbound',
        bytesSent: sentBytes,
        packetsSent: 100,
        retransmittedPacketsSent: 2,
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
        framesEncoded: 120,
        qualityLimitationReason: 'bandwidth',
      },
    ],
    [
      'remote-inbound',
      {
        id: 'remote-inbound',
        type: 'remote-inbound-rtp',
        kind: 'video',
        packetsLost: 2,
        packetsReceived: 98,
        roundTripTime: 0.075,
      },
    ],
    [
      'inbound',
      {
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp,
        codecId: 'codec-in',
        bytesReceived: receivedBytes,
        packetsLost: 1,
        packetsReceived: 99,
        jitter: 0.012,
        frameWidth: 640,
        frameHeight: 360,
        framesPerSecond: 24,
        framesDropped: 3,
        freezeCount: 1,
      },
    ],
    [
      'transport',
      {
        id: 'transport',
        type: 'transport',
        selectedCandidatePairId: 'pair',
      },
    ],
    [
      'pair',
      {
        id: 'pair',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        currentRoundTripTime: 0.08,
        availableOutgoingBitrate: 2_500_000,
      },
    ],
    [
      'local',
      {
        id: 'local',
        type: 'local-candidate',
        candidateType: 'relay',
        protocol: 'udp',
        relayProtocol: 'udp',
      },
    ],
    [
      'remote',
      {
        id: 'remote',
        type: 'remote-candidate',
        candidateType: 'srflx',
        protocol: 'udp',
      },
    ],
  ]);
}

describe('collectWebRTCDiagnostics', () => {
  it('computes interval bitrates and reports codec, loss and selected ICE pair', async () => {
    const accumulator = createCallStatsAccumulator();
    const peerConnection = {
      getStats: jest
        .fn()
        .mockResolvedValueOnce(statsSample(1_000, 1_000, 2_000))
        .mockResolvedValueOnce(statsSample(5_000, 5_000, 6_000)),
    };

    const first = await collectWebRTCDiagnostics(
      peerConnection,
      accumulator,
      { width: 1280, height: 720, frameRate: 30, facingMode: 'user' },
    );
    expect(first?.outboundVideo?.bitrateBps).toBeNull();
    expect(first?.inboundVideo?.bitrateBps).toBeNull();

    const second = await collectWebRTCDiagnostics(
      peerConnection,
      accumulator,
      { width: 1280, height: 720, frameRate: 30, facingMode: 'user' },
    );

    expect(second?.outboundVideo).toMatchObject({
      codec: 'H264',
      frameWidth: 1280,
      frameHeight: 720,
      framesPerSecond: 30,
      bitrateBps: 8_000,
      packetsLost: 2,
      packetLossPercent: 2,
      roundTripTimeMs: 75,
      qualityLimitationReason: 'bandwidth',
    });
    expect(second?.inboundVideo).toMatchObject({
      codec: 'VP8',
      bitrateBps: 8_000,
      packetsLost: 1,
      jitterMs: 12,
      framesDropped: 3,
      freezeCount: 1,
    });
    expect(second?.candidatePair).toMatchObject({
      id: 'pair',
      localCandidateType: 'relay',
      remoteCandidateType: 'srflx',
      relayProtocol: 'udp',
      selectedUsesTurn: true,
      currentRoundTripTimeMs: 80,
      availableOutgoingBitrate: 2_500_000,
    });
  });
});
