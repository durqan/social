import {
  API_BASE_URL,
  NOTIFICATIONS_BASE_URL,
  TURN_URLS,
  WEBRTC_FORCE_RELAY,
  WS_URL,
} from '../config/env';

type CallDiagnosticTag =
  | 'CALL_UI'
  | 'CALL_START'
  | 'CALL_API'
  | 'CALL_WS'
  | 'CALL_WEBRTC'
  | 'CALL_ERROR'
  | 'CALL_ENV';

let envLogged = false;

export function sanitizeEndpoint(value: string | undefined | null) {
  const raw = value?.trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw);
    const auth = url.host;
    const path = `${url.pathname}${url.search ? '?redacted' : ''}`;
    return `${url.protocol}//${auth}${path}`;
  } catch {
    return raw.replace(
      /([?&](?:token|key|secret|credential|password)=)[^&]+/gi,
      '$1redacted',
    );
  }
}

export function describeCallError(error: unknown) {
  if (error instanceof Error) {
    const apiError = error as Error & {
      status?: unknown;
      kind?: unknown;
      details?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      status: apiError.status,
      kind: apiError.kind,
      details: apiError.details,
    };
  }

  return {
    message: String(error),
  };
}

function writeCallLog(
  method: 'log' | 'warn' | 'error',
  tag: CallDiagnosticTag,
  message: string,
  details?: unknown,
) {
  const prefix = `[${tag}] ${message}`;
  if (details === undefined) {
    console[method](prefix);
    return;
  }

  console[method](prefix, details);
}

export function callLog(
  tag: CallDiagnosticTag,
  message: string,
  details?: unknown,
) {
  writeCallLog('log', tag, message, details);
}

export function callWarn(
  tag: CallDiagnosticTag,
  message: string,
  details?: unknown,
) {
  writeCallLog('warn', tag, message, details);
}

export function callError(
  tag: CallDiagnosticTag,
  message: string,
  details?: unknown,
) {
  writeCallLog('error', tag, message, details);
}

export function logCallEnvOnce(source = 'app_start') {
  if (envLogged) {
    return;
  }
  envLogged = true;

  const apiBaseURL = sanitizeEndpoint(API_BASE_URL);
  const notificationsBaseURL = sanitizeEndpoint(NOTIFICATIONS_BASE_URL);
  const wsURL = sanitizeEndpoint(WS_URL);
  const releaseMode = !__DEV__;

  callLog('CALL_ENV', 'runtime config', {
    source,
    mode: releaseMode ? 'release' : 'debug',
    apiBaseURL,
    notificationsBaseURL,
    wsURL,
    turnConfigured: TURN_URLS.length > 0,
    forceRelay: WEBRTC_FORCE_RELAY,
  });

  if (releaseMode && API_BASE_URL.startsWith('http://')) {
    callWarn('CALL_ENV', 'release API URL is cleartext HTTP', { apiBaseURL });
  }

  if (releaseMode && WS_URL.startsWith('ws://')) {
    callWarn('CALL_ENV', 'release WebSocket URL is cleartext WS', { wsURL });
  }

  if (!API_BASE_URL) {
    callWarn('CALL_ENV', 'API base URL is empty');
  }
}
