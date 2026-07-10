export type RTCStatsValue = {
  id?: string;
  type?: string;
  timestamp?: number;
  kind?: string;
  mediaType?: string;
  codecId?: string;
  remoteId?: string;
  localId?: string;
  mimeType?: string;
  sdpFmtpLine?: string;
  payloadType?: number;
  ssrc?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetsSent?: number;
  jitter?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
  bytesSent?: number;
  bytesReceived?: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  state?: string;
  selected?: boolean;
  nominated?: boolean;
  candidateType?: string;
  protocol?: string;
  relayProtocol?: string;
  url?: string;
  networkType?: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  framesEncoded?: number;
  framesDecoded?: number;
  framesSent?: number;
  framesReceived?: number;
  framesDropped?: number;
  freezeCount?: number;
  totalFreezesDuration?: number;
  retransmittedPacketsSent?: number;
  qualityLimitationReason?: string;
  qualityLimitationDurations?: Record<string, number>;
  nackCount?: number;
  pliCount?: number;
  firCount?: number;
  targetBitrate?: number;
  totalEncodeTime?: number;
  qpSum?: number;
  encoderImplementation?: string;
  decoderImplementation?: string;
  powerEfficientEncoder?: boolean;
  powerEfficientDecoder?: boolean;
};

export type CallStatsAccumulator = {
  byteSamples: Map<
    string,
    {
      bytes: number;
      timestamp: number;
    }
  >;
};

export type VideoCaptureSettings = {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
};

export type WebRTCVideoOutboundStats = {
  codec: string | null;
  codecFmtp: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bytesSent: number | null;
  bitrateBps: number | null;
  packetsSent: number | null;
  packetsLost: number | null;
  packetLossPercent: number | null;
  retransmittedPacketsSent: number | null;
  framesEncoded: number | null;
  framesSent: number | null;
  qualityLimitationReason: string | null;
  qualityLimitationDurations: Record<string, number> | null;
  roundTripTimeMs: number | null;
  nackCount: number | null;
  pliCount: number | null;
  firCount: number | null;
  targetBitrate: number | null;
  totalEncodeTime: number | null;
  qpSum: number | null;
  encoderImplementation: string | null;
  powerEfficientEncoder: boolean | null;
};

export type WebRTCVideoInboundStats = {
  codec: string | null;
  codecFmtp: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bytesReceived: number | null;
  bitrateBps: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  framesDecoded: number | null;
  framesReceived: number | null;
  framesDropped: number | null;
  freezeCount: number | null;
  totalFreezesDuration: number | null;
  nackCount: number | null;
  pliCount: number | null;
  firCount: number | null;
  decoderImplementation: string | null;
  powerEfficientDecoder: boolean | null;
};

export type WebRTCCandidatePairStats = {
  id: string | null;
  currentRoundTripTimeMs: number | null;
  availableOutgoingBitrate: number | null;
  availableIncomingBitrate: number | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  localProtocol: string | null;
  remoteProtocol: string | null;
  relayProtocol: string | null;
  networkType: string | null;
  turnURL: string | null;
  selectedUsesTurn: boolean;
};

export type WebRTCDiagnosticsSnapshot = {
  sampledAt: number;
  capture: VideoCaptureSettings | null;
  outboundVideo: WebRTCVideoOutboundStats | null;
  inboundVideo: WebRTCVideoInboundStats | null;
  candidatePair: WebRTCCandidatePairStats | null;
};

export function createCallStatsAccumulator(): CallStatsAccumulator {
  return { byteSamples: new Map() };
}

function statsReportValues(report: unknown) {
  const values: RTCStatsValue[] = [];
  const mapLike = report as {
    forEach?: (callback: (value: unknown) => void) => void;
  };

  if (typeof mapLike?.forEach === 'function') {
    mapLike.forEach(value => {
      if (value && typeof value === 'object') {
        values.push(value as RTCStatsValue);
      }
    });
    return values;
  }

  if (report && typeof report === 'object') {
    Object.values(report as Record<string, unknown>).forEach(value => {
      if (value && typeof value === 'object') {
        values.push(value as RTCStatsValue);
      }
    });
  }
  return values;
}

function statsMediaKind(stat: RTCStatsValue) {
  return stat.kind ?? stat.mediaType ?? 'unknown';
}

function optionalNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricMs(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1000)
    : null;
}

function packetLossPercent(
  packetsLost: number | undefined,
  deliveredPackets: number | undefined,
) {
  if (typeof packetsLost !== 'number' || typeof deliveredPackets !== 'number') {
    return null;
  }
  const total = Math.max(0, packetsLost) + Math.max(0, deliveredPackets);
  return total > 0 ? Math.round((Math.max(0, packetsLost) / total) * 1000) / 10 : null;
}

function bitrateFromBytes(
  stat: RTCStatsValue,
  field: 'bytesSent' | 'bytesReceived',
  accumulator: CallStatsAccumulator,
) {
  const bytes = stat[field];
  if (typeof bytes !== 'number') {
    return null;
  }

  const timestamp =
    typeof stat.timestamp === 'number' ? stat.timestamp : Date.now();
  const key = `${stat.id ?? stat.type}:${field}`;
  const previous = accumulator.byteSamples.get(key);
  accumulator.byteSamples.set(key, { bytes, timestamp });

  if (!previous || timestamp <= previous.timestamp || bytes < previous.bytes) {
    return null;
  }
  return Math.round(
    ((bytes - previous.bytes) * 8 * 1000) / (timestamp - previous.timestamp),
  );
}

function codecSummary(
  stat: RTCStatsValue,
  statsById: Map<string, RTCStatsValue>,
) {
  const codec = stat.codecId ? statsById.get(stat.codecId) : undefined;
  const mimeType = codec?.mimeType ?? null;
  return {
    codec: mimeType ? mimeType.replace(/^video\//i, '') : null,
    codecFmtp: codec?.sdpFmtpLine ?? null,
  };
}

function findRelatedRemoteInbound(
  outbound: RTCStatsValue,
  stats: RTCStatsValue[],
  statsById: Map<string, RTCStatsValue>,
) {
  if (outbound.remoteId) {
    const related = statsById.get(outbound.remoteId);
    if (related?.type === 'remote-inbound-rtp') {
      return related;
    }
  }
  return stats.find(
    stat =>
      stat.type === 'remote-inbound-rtp' && statsMediaKind(stat) === 'video',
  );
}

function summarizeOutboundVideo(
  stats: RTCStatsValue[],
  statsById: Map<string, RTCStatsValue>,
  accumulator: CallStatsAccumulator,
) {
  const outbound = stats.find(
    stat => stat.type === 'outbound-rtp' && statsMediaKind(stat) === 'video',
  );
  if (!outbound) {
    return null;
  }

  const remoteInbound = findRelatedRemoteInbound(outbound, stats, statsById);
  const codec = codecSummary(outbound, statsById);
  return {
    ...codec,
    frameWidth: optionalNumber(outbound.frameWidth),
    frameHeight: optionalNumber(outbound.frameHeight),
    framesPerSecond: optionalNumber(outbound.framesPerSecond),
    bytesSent: optionalNumber(outbound.bytesSent),
    bitrateBps: bitrateFromBytes(outbound, 'bytesSent', accumulator),
    packetsSent: optionalNumber(outbound.packetsSent),
    packetsLost: optionalNumber(remoteInbound?.packetsLost),
    packetLossPercent: packetLossPercent(
      remoteInbound?.packetsLost,
      remoteInbound?.packetsReceived,
    ),
    retransmittedPacketsSent: optionalNumber(outbound.retransmittedPacketsSent),
    framesEncoded: optionalNumber(outbound.framesEncoded),
    framesSent: optionalNumber(outbound.framesSent),
    qualityLimitationReason: outbound.qualityLimitationReason ?? null,
    qualityLimitationDurations: outbound.qualityLimitationDurations ?? null,
    roundTripTimeMs: metricMs(remoteInbound?.roundTripTime),
    nackCount: optionalNumber(outbound.nackCount),
    pliCount: optionalNumber(outbound.pliCount),
    firCount: optionalNumber(outbound.firCount),
    targetBitrate: optionalNumber(outbound.targetBitrate),
    totalEncodeTime: optionalNumber(outbound.totalEncodeTime),
    qpSum: optionalNumber(outbound.qpSum),
    encoderImplementation: outbound.encoderImplementation ?? null,
    powerEfficientEncoder:
      typeof outbound.powerEfficientEncoder === 'boolean'
        ? outbound.powerEfficientEncoder
        : null,
  } satisfies WebRTCVideoOutboundStats;
}

function summarizeInboundVideo(
  stats: RTCStatsValue[],
  statsById: Map<string, RTCStatsValue>,
  accumulator: CallStatsAccumulator,
) {
  const inbound = stats.find(
    stat => stat.type === 'inbound-rtp' && statsMediaKind(stat) === 'video',
  );
  if (!inbound) {
    return null;
  }

  const codec = codecSummary(inbound, statsById);
  return {
    ...codec,
    frameWidth: optionalNumber(inbound.frameWidth),
    frameHeight: optionalNumber(inbound.frameHeight),
    framesPerSecond: optionalNumber(inbound.framesPerSecond),
    bytesReceived: optionalNumber(inbound.bytesReceived),
    bitrateBps: bitrateFromBytes(inbound, 'bytesReceived', accumulator),
    packetsReceived: optionalNumber(inbound.packetsReceived),
    packetsLost: optionalNumber(inbound.packetsLost),
    packetLossPercent: packetLossPercent(
      inbound.packetsLost,
      inbound.packetsReceived,
    ),
    jitterMs: metricMs(inbound.jitter),
    framesDecoded: optionalNumber(inbound.framesDecoded),
    framesReceived: optionalNumber(inbound.framesReceived),
    framesDropped: optionalNumber(inbound.framesDropped),
    freezeCount: optionalNumber(inbound.freezeCount),
    totalFreezesDuration: optionalNumber(inbound.totalFreezesDuration),
    nackCount: optionalNumber(inbound.nackCount),
    pliCount: optionalNumber(inbound.pliCount),
    firCount: optionalNumber(inbound.firCount),
    decoderImplementation: inbound.decoderImplementation ?? null,
    powerEfficientDecoder:
      typeof inbound.powerEfficientDecoder === 'boolean'
        ? inbound.powerEfficientDecoder
        : null,
  } satisfies WebRTCVideoInboundStats;
}

function summarizeCandidatePair(
  stats: RTCStatsValue[],
  statsById: Map<string, RTCStatsValue>,
) {
  const selectedPairId = stats.find(
    stat =>
      stat.type === 'transport' &&
      typeof stat.selectedCandidatePairId === 'string',
  )?.selectedCandidatePairId;
  const selectedPair =
    (selectedPairId ? statsById.get(selectedPairId) : undefined) ??
    stats.find(
      stat =>
        stat.type === 'candidate-pair' &&
        (stat.selected === true ||
          (stat.state === 'succeeded' && stat.nominated === true)),
    );

  if (!selectedPair) {
    return null;
  }

  const localCandidate = selectedPair.localCandidateId
    ? statsById.get(selectedPair.localCandidateId)
    : undefined;
  const remoteCandidate = selectedPair.remoteCandidateId
    ? statsById.get(selectedPair.remoteCandidateId)
    : undefined;

  return {
    id: selectedPair.id ?? null,
    currentRoundTripTimeMs: metricMs(selectedPair.currentRoundTripTime),
    availableOutgoingBitrate: optionalNumber(
      selectedPair.availableOutgoingBitrate,
    ),
    availableIncomingBitrate: optionalNumber(
      selectedPair.availableIncomingBitrate,
    ),
    localCandidateType: localCandidate?.candidateType ?? null,
    remoteCandidateType: remoteCandidate?.candidateType ?? null,
    localProtocol: localCandidate?.protocol ?? null,
    remoteProtocol: remoteCandidate?.protocol ?? null,
    relayProtocol:
      localCandidate?.relayProtocol ?? remoteCandidate?.relayProtocol ?? null,
    networkType: localCandidate?.networkType ?? null,
    turnURL: localCandidate?.url ?? remoteCandidate?.url ?? null,
    selectedUsesTurn:
      localCandidate?.candidateType === 'relay' ||
      remoteCandidate?.candidateType === 'relay',
  } satisfies WebRTCCandidatePairStats;
}

export async function collectWebRTCDiagnostics(
  peerConnection: { getStats?: () => Promise<unknown> },
  accumulator: CallStatsAccumulator,
  capture: VideoCaptureSettings | null,
): Promise<WebRTCDiagnosticsSnapshot | null> {
  if (typeof peerConnection.getStats !== 'function') {
    return null;
  }

  const stats = statsReportValues(await peerConnection.getStats());
  const statsById = new Map(
    stats
      .filter(stat => stat.id)
      .map(stat => [stat.id as string, stat] as const),
  );

  return {
    sampledAt: Date.now(),
    capture,
    outboundVideo: summarizeOutboundVideo(stats, statsById, accumulator),
    inboundVideo: summarizeInboundVideo(stats, statsById, accumulator),
    candidatePair: summarizeCandidatePair(stats, statsById),
  };
}
