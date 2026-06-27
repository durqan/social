import {
  isLiveServerCall,
  isTerminalCallStatus,
  shouldKeepLocalServerCall,
  shouldShowIncomingServerCall,
} from './callSync';
import type { ActiveCall } from '../api/calls';

function call(overrides: Partial<ActiveCall> = {}): ActiveCall {
  return {
    call_id: 'call-1',
    caller_id: 1,
    callee_id: 2,
    call_type: 'audio',
    status: 'ringing',
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    offer: { type: 'offer', sdp: 'sdp' },
    ...overrides,
  };
}

describe('call sync helpers', () => {
  it('treats terminal server statuses as not live', () => {
    expect(isTerminalCallStatus('ended')).toBe(true);
    expect(isTerminalCallStatus('missed')).toBe(true);
    expect(isLiveServerCall(call({ status: 'ended' }))).toBe(false);
  });

  it('drops expired ringing calls', () => {
    expect(
      isLiveServerCall(
        call({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      ),
    ).toBe(false);
  });

  it('shows only live incoming calls for the callee with an offer', () => {
    expect(shouldShowIncomingServerCall(call(), 2)).toBe(true);
    expect(shouldShowIncomingServerCall(call(), 1)).toBe(false);
    expect(shouldShowIncomingServerCall(call({ offer: undefined }), 2)).toBe(
      false,
    );
  });

  it('keeps only the matching active local call id', () => {
    expect(
      shouldKeepLocalServerCall(call({ status: 'answered' }), 'call-1'),
    ).toBe(true);
    expect(
      shouldKeepLocalServerCall(call({ status: 'answered' }), 'call-2'),
    ).toBe(false);
    expect(shouldKeepLocalServerCall(call({ status: 'ended' }), 'call-1')).toBe(
      false,
    );
  });
});
