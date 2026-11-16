export type ProviderHealthState = 'not_probed';
export type ProviderCredentialState =
  | 'access_token_valid_or_expiry_unknown'
  | 'access_expired_refresh_available'
  | 'access_expired_reauthorization_required'
  | 'reauthorization_required'
  | 'revocation_pending'
  | 'revoked'
  | 'disconnected';

export interface ProviderConnectionStateInput {
  status: string;
  accessTokenExpiresAt?: Date | string | null;
  hasRefreshToken: boolean;
  revokedAt?: Date | string | null;
}

/**
 * Reports persisted authorization facts only. It deliberately does not infer
 * provider health from an OAuth record: a live API probe is a separate signal.
 */
export function describeProviderConnectionState(
  input: ProviderConnectionStateInput,
  now: Date = new Date(),
) {
  let credentialState: ProviderCredentialState;
  if (input.status === 'reauthorization_required') credentialState = 'reauthorization_required';
  else if (input.status === 'revocation_pending') credentialState = 'revocation_pending';
  else if (input.status === 'revoked' || input.revokedAt) credentialState = 'revoked';
  else if (input.status !== 'connected') credentialState = 'disconnected';
  else {
    const expiry = input.accessTokenExpiresAt ? new Date(input.accessTokenExpiresAt).getTime() : Number.NaN;
    const expired = Number.isFinite(expiry) && expiry <= now.getTime();
    credentialState = expired
      ? input.hasRefreshToken ? 'access_expired_refresh_available' : 'access_expired_reauthorization_required'
      : 'access_token_valid_or_expiry_unknown';
  }

  return {
    connectionState: input.status,
    credentialState,
    healthState: 'not_probed' as const,
    lastHealthCheckAt: null,
    healthNote: 'OAuth state is not a live provider health check; no provider API probe was performed.',
  };
}
