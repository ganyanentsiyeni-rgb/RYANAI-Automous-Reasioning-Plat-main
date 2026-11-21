export type CapabilityState =
  | 'blocked_not_connected'
  | 'blocked_connection_revoked'
  | 'blocked_reauthorization_required'
  | 'blocked_revocation_pending'
  | 'blocked_connection_unavailable'
  | 'blocked_adapter_required'
  | 'configured_unverified';

export function describeCapabilityState(input: {
  connectionStatus: string;
  adapterStatus: string;
}) {
  let state: CapabilityState;
  if (input.connectionStatus === 'not_connected') state = 'blocked_not_connected';
  else if (input.connectionStatus === 'revoked') state = 'blocked_connection_revoked';
  else if (input.connectionStatus === 'reauthorization_required') state = 'blocked_reauthorization_required';
  else if (input.connectionStatus === 'revocation_pending') state = 'blocked_revocation_pending';
  else if (input.connectionStatus !== 'connected') state = 'blocked_connection_unavailable';
  else if (input.adapterStatus !== 'adapter_registered') state = 'blocked_adapter_required';
  else state = 'configured_unverified';

  return {
    state,
    healthState: 'not_probed' as const,
    authorizationState: 'genx_per_invocation_required' as const,
    eligibleForAuthorization: state === 'configured_unverified',
    executionAuthorized: false as const,
  };
}
