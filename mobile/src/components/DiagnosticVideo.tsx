import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Video, {
  type OnLoadData,
  type OnVideoErrorData,
  type ReactVideoProps,
  type ReactVideoSource,
} from 'react-native-video';

import { getCookieHeader } from '../api/http';
import { API_BASE_URL } from '../config/env';
import { logDev, warnDev } from '../utils/logger';

type DiagnosticVideoSource = ReactVideoSource & { uri: string };

type DiagnosticVideoProps = Omit<
  ReactVideoProps,
  'source' | 'onError' | 'onLoad' | 'onLoadStart'
> & {
  source: DiagnosticVideoSource;
  diagnosticLabel?: string;
  onError?: (event: OnVideoErrorData) => void;
  onLoad?: (event: OnLoadData) => void;
  onLoadStart?: ReactVideoProps['onLoadStart'];
};

type VideoHTTPProbe = {
  requestedURL: string;
  finalURL: string | null;
  redirected: boolean;
  headStatus: number | null;
  rangeStatus: number | null;
  contentType: string | null;
  contentLength: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
  location: string | null;
  error: string | null;
};

function isHTTPURL(url: string) {
  return /^https?:\/\//i.test(url);
}

function needsSessionCookie(url: string) {
  if (!isHTTPURL(url)) {
    return false;
  }

  try {
    const media = new URL(url);
    const api = new URL(API_BASE_URL);
    return media.origin === api.origin;
  } catch {
    return url.startsWith(API_BASE_URL);
  }
}

function safeVideoURL(url: string) {
  if (url.startsWith('data:')) {
    const mediaType = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : 40);
    return `data:${mediaType};[${url.length} chars]`;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${
      parsed.search ? '?redacted' : ''
    }`;
  } catch {
    return url.length > 240 ? `${url.slice(0, 240)}…` : url;
  }
}

function androidDeviceSummary() {
  const constants = Platform.constants as typeof Platform.constants & {
    Brand?: string;
    Manufacturer?: string;
    Model?: string;
    Release?: string;
  };

  return {
    platform: Platform.OS,
    brand: constants.Brand ?? null,
    manufacturer: constants.Manufacturer ?? null,
    model: constants.Model ?? null,
    androidApiLevel: Platform.OS === 'android' ? Platform.Version : null,
    androidRelease: constants.Release ?? null,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeVideoHTTP(
  url: string,
  headers: Record<string, string>,
): Promise<VideoHTTPProbe> {
  const result: VideoHTTPProbe = {
    requestedURL: safeVideoURL(url),
    finalURL: null,
    redirected: false,
    headStatus: null,
    rangeStatus: null,
    contentType: null,
    contentLength: null,
    acceptRanges: null,
    contentRange: null,
    location: null,
    error: null,
  };
  if (!isHTTPURL(url)) {
    return result;
  }

  try {
    const head = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers,
      credentials: 'include',
    });
    result.headStatus = head.status;
    result.finalURL = safeVideoURL(head.url || url);
    result.redirected = Boolean(head.redirected || (head.url && head.url !== url));
    result.contentType = head.headers.get('content-type');
    result.contentLength = head.headers.get('content-length');
    result.acceptRanges = head.headers.get('accept-ranges');
    result.contentRange = head.headers.get('content-range');
    result.location = head.headers.get('location');

    if (/bytes/i.test(result.acceptRanges ?? '')) {
      const range = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { ...headers, Range: 'bytes=0-1' },
        credentials: 'include',
      });
      result.rangeStatus = range.status;
      result.finalURL = safeVideoURL(range.url || head.url || url);
      result.redirected = Boolean(
        result.redirected || range.redirected || (range.url && range.url !== url),
      );
      result.contentType = range.headers.get('content-type') ?? result.contentType;
      result.contentLength =
        range.headers.get('content-length') ?? result.contentLength;
      result.acceptRanges =
        range.headers.get('accept-ranges') ?? result.acceptRanges;
      result.contentRange =
        range.headers.get('content-range') ?? result.contentRange;
      result.location = range.headers.get('location') ?? result.location;

      const rangeLength = Number(range.headers.get('content-length'));
      if (range.status === 206 && Number.isFinite(rangeLength) && rangeLength <= 16) {
        await range.arrayBuffer();
      } else {
        const cancellable = range as Response & {
          body?: { cancel?: () => Promise<void> };
        };
        await cancellable.body?.cancel?.().catch(() => undefined);
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  return result;
}

function decoderDetails(event: OnVideoErrorData) {
  const error = event.error;
  const combined = [
    error.errorString,
    error.errorException,
    error.errorStackTrace,
    error.localizedDescription,
    error.localizedFailureReason,
  ]
    .filter(Boolean)
    .join('\n');

  const decoderLines = combined
    .split('\n')
    .filter(line => /decoder|mediacodec|exoplayer|renderer|codec/i.test(line))
    .slice(0, 12);

  return {
    errorCode: error.errorCode ?? error.code ?? null,
    errorString: error.errorString ?? error.localizedDescription ?? error.error ?? null,
    errorException: error.errorException ?? null,
    decoderError: decoderLines.length > 0 ? decoderLines.join('\n') : null,
    stackTrace: error.errorStackTrace ?? null,
    cause: event.cause ?? null,
  };
}

export function DiagnosticVideo({
  source,
  diagnosticLabel = 'chat-video',
  onError,
  onLoad,
  onLoadStart,
  ...props
}: DiagnosticVideoProps) {
  const requiresCookie = needsSessionCookie(source.uri);
  const [authHeaders, setAuthHeaders] = useState<Record<string, string> | null>(
    requiresCookie ? null : {},
  );
  const probeRef = useRef<VideoHTTPProbe | null>(null);
  const safeURL = useMemo(() => safeVideoURL(source.uri), [source.uri]);

  useEffect(() => {
    let active = true;
    probeRef.current = null;
    setAuthHeaders(requiresCookie ? null : {});

    if (!requiresCookie) {
      return () => {
        active = false;
      };
    }

    getCookieHeader()
      .then(cookie => {
        if (active) {
          setAuthHeaders(cookie ? { Cookie: cookie } : {});
        }
      })
      .catch(error => {
        warnDev('[VIDEO_PLAYER] failed to read session cookie', {
          label: diagnosticLabel,
          url: safeURL,
          error: error instanceof Error ? error.message : String(error),
        });
        if (active) {
          setAuthHeaders({});
        }
      });

    return () => {
      active = false;
    };
  }, [diagnosticLabel, requiresCookie, safeURL]);

  const requestHeaders = useMemo<Record<string, string>>(
    () => ({
      Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1',
      ...(source.headers ?? {}),
      ...(authHeaders ?? {}),
    }),
    [authHeaders, source.headers],
  );

  const resolvedSource = useMemo<DiagnosticVideoSource>(
    () => ({ ...source, headers: requestHeaders }),
    [requestHeaders, source],
  );

  const ensureProbe = useCallback(async () => {
    if (probeRef.current) {
      return probeRef.current;
    }
    const probe = await probeVideoHTTP(source.uri, requestHeaders);
    probeRef.current = probe;
    return probe;
  }, [requestHeaders, source.uri]);

  useEffect(() => {
    if (!__DEV__ || !authHeaders || !isHTTPURL(source.uri)) {
      return;
    }
    ensureProbe()
      .then(http => {
        logDev('[VIDEO_PLAYER] HTTP probe', {
          label: diagnosticLabel,
          device: androidDeviceSummary(),
          http,
          hasSessionCookie: Boolean(requestHeaders.Cookie),
        });
      })
      .catch(() => undefined);
  }, [authHeaders, diagnosticLabel, ensureProbe, requestHeaders.Cookie, source.uri]);

  if (!authHeaders) {
    return null;
  }

  return (
    <Video
      {...props}
      source={resolvedSource}
      onLoadStart={event => {
        logDev('[VIDEO_PLAYER] load start', {
          label: diagnosticLabel,
          url: safeURL,
          device: androidDeviceSummary(),
          hasSessionCookie: Boolean(requestHeaders.Cookie),
        });
        onLoadStart?.(event);
      }}
      onLoad={event => {
        logDev('[VIDEO_PLAYER] loaded', {
          label: diagnosticLabel,
          url: safeURL,
          duration: event.duration,
          naturalSize: event.naturalSize,
          audioTracks: event.audioTracks?.length ?? 0,
          textTracks: event.textTracks?.length ?? 0,
        });
        if (!event.duration || event.duration <= 0) {
          ensureProbe()
            .then(http => {
              console.warn('[VIDEO_PLAYER_ZERO_DURATION]', {
                label: diagnosticLabel,
                url: safeURL,
                device: androidDeviceSummary(),
                duration: event.duration,
                http,
              });
            })
            .catch(() => undefined);
        }
        onLoad?.(event);
      }}
      onError={event => {
        onError?.(event);
        ensureProbe()
          .then(http => {
            console.error('[VIDEO_PLAYER_ERROR]', {
              label: diagnosticLabel,
              url: safeURL,
              device: androidDeviceSummary(),
              httpStatus: http.rangeStatus ?? http.headStatus,
              contentType: http.contentType,
              contentLength: http.contentLength,
              acceptRanges: http.acceptRanges,
              contentRange: http.contentRange,
              redirected: http.redirected,
              finalURL: http.finalURL,
              httpError: http.error,
              player: decoderDetails(event),
            });
          })
          .catch(probeError => {
            console.error('[VIDEO_PLAYER_ERROR]', {
              label: diagnosticLabel,
              url: safeURL,
              device: androidDeviceSummary(),
              httpProbeError:
                probeError instanceof Error ? probeError.message : String(probeError),
              player: decoderDetails(event),
            });
          });
      }}
    />
  );
}
