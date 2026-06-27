import type { ActiveCall, ActiveCallStatus } from '../api/calls';

const terminalCallStatuses: ReadonlySet<ActiveCallStatus> = new Set([
  'declined',
  'rejected',
  'missed',
  'ended',
  'failed',
  'replaced',
]);

export function isTerminalCallStatus(status?: ActiveCallStatus | null) {
  return Boolean(status && terminalCallStatuses.has(status));
}

export function isLiveServerCall(call: ActiveCall | null | undefined) {
  if (!call || isTerminalCallStatus(call.status)) {
    return false;
  }
  if (call.status === 'answered' || call.status === 'accepted') {
    return true;
  }
  if (call.status !== 'ringing') {
    return false;
  }
  if (!call.expires_at) {
    return true;
  }

  const expiresAt = Date.parse(call.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function shouldShowIncomingServerCall(
  call: ActiveCall | null | undefined,
  userId: number | null | undefined,
) {
  return Boolean(
    userId &&
      call?.status === 'ringing' &&
      isLiveServerCall(call) &&
      call.callee_id === userId &&
      call.caller_id !== userId &&
      call.offer,
  );
}

export function shouldKeepLocalServerCall(
  call: ActiveCall | null | undefined,
  currentCallId: string | null | undefined,
) {
  return Boolean(
    currentCallId && call?.call_id === currentCallId && isLiveServerCall(call),
  );
}
