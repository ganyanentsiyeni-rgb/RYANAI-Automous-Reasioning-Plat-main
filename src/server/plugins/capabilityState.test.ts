import { describe, expect, it } from 'vitest';
import { describeCapabilityState } from './capabilityState.js';

describe('authoritative capability state', () => {
  it('blocks catalogue capabilities until a provider is connected', () => {
    expect(describeCapabilityState({ connectionStatus: 'not_connected', adapterStatus: 'adapter_required' })).toMatchObject({
      state: 'blocked_not_connected', healthState: 'not_probed',
      eligibleForAuthorization: false, executionAuthorized: false,
    });
  });

  it('does not mistake an OAuth connection for an installed adapter', () => {
    expect(describeCapabilityState({ connectionStatus: 'connected', adapterStatus: 'adapter_required' }).state).toBe('blocked_adapter_required');
  });

  it('marks configured adapters as unverified and still requires per-call Gen-X authorization', () => {
    expect(describeCapabilityState({ connectionStatus: 'connected', adapterStatus: 'adapter_registered' })).toEqual({
      state: 'configured_unverified', healthState: 'not_probed',
      authorizationState: 'genx_per_invocation_required',
      eligibleForAuthorization: true, executionAuthorized: false,
    });
  });

  it('preserves revoked, reauthorization and pending-revocation blockers', () => {
    expect(describeCapabilityState({ connectionStatus: 'revoked', adapterStatus: 'adapter_registered' }).state).toBe('blocked_connection_revoked');
    expect(describeCapabilityState({ connectionStatus: 'reauthorization_required', adapterStatus: 'adapter_registered' }).state).toBe('blocked_reauthorization_required');
    expect(describeCapabilityState({ connectionStatus: 'revocation_pending', adapterStatus: 'adapter_registered' }).state).toBe('blocked_revocation_pending');
  });
});
