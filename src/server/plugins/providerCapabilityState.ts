export type ProviderAuthenticationStatus =
  | 'not_authenticated'
  | 'oauth_grant_issued'
  | 'expired'
  | 'expiry_unknown'
  | 'reauthorization_required'
  | 'revoked'
  | 'pending'
  | 'error'
  | 'unknown';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'not_probed';

export type ProviderExecutionStatus =
  | 'blocked_adapter_missing'
  | 'blocked_connection'
  | 'blocked_revoked'
  | 'blocked_authentication'
  | 'blocked_health_unverified'
  | 'blocked_health_degraded'
  | 'blocked_health_unavailable'
  | 'ready';

export interface ProviderConnectionEvidence {
  status: string;
  revokedAt?: Date | null;
  accessTokenExpiresAt?: Date | null;
  hasRefreshToken?: boolean;
}

export interface ProviderCapabilityState {
  connectionStatus: string;
  authenticationStatus: ProviderAuthenticationStatus;
  healthStatus: ProviderHealthStatus;
  executionStatus: ProviderExecutionStatus;
  usable: boolean;
}

/**
 * Resolve capability readiness from independent evidence layers.
 * An OAuth token exchange is not a live provider health check; without a
 * provider-specific authenticated probe, execution remains blocked.
 */
export function resolveProviderCapabilityState(
  adapterStatus: string,
  connection: ProviderConnectionEvidence | null | undefined,
  now = new Date(),
  healthStatus: ProviderHealthStatus = 'not_probed',
): ProviderCapabilityState {
  const tokenExpiry = connection?.accessTokenExpiresAt?.getTime() ?? null;
  const tokenExpired = tokenExpiry !== null && tokenExpiry <= now.getTime();
  const tokenExpiryUnknown = Boolean(connection && connection.status === 'connected' && !connection.revokedAt && tokenExpiry === null);
  const connectionStatus = !connection
    ? 'not_connected'
    : connection.revokedAt || connection.status === 'revoked'
      ? 'revoked'
      : connection.status === 'connected' && tokenExpiryUnknown
        ? 'expiry_unknown'
        : connection.status === 'connected' && tokenExpired
          ? connection.hasRefreshToken ? 'refresh_required' : 'reauthorization_required'
          : connection.status;

  let authenticationStatus: ProviderAuthenticationStatus = 'not_authenticated';
  if (connection) {
    if (connectionStatus === 'revoked') authenticationStatus = 'revoked';
    else if (connectionStatus === 'reauthorization_required') authenticationStatus = 'reauthorization_required';
    else if (connectionStatus === 'refresh_required') authenticationStatus = 'expired';
    else if (connectionStatus === 'expiry_unknown') authenticationStatus = 'expiry_unknown';
    else if (connectionStatus === 'pending') authenticationStatus = 'pending';
    else if (connectionStatus === 'error') authenticationStatus = 'error';
    else if (connectionStatus === 'connected') authenticationStatus = 'oauth_grant_issued';
    else authenticationStatus = 'unknown';
  }

  let executionStatus: ProviderExecutionStatus;
  if (connectionStatus === 'revoked') executionStatus = 'blocked_revoked';
  else if (connectionStatus !== 'connected') executionStatus = 'blocked_connection';
  else if (authenticationStatus !== 'oauth_grant_issued') executionStatus = 'blocked_authentication';
  else if (adapterStatus !== 'adapter_registered') executionStatus = 'blocked_adapter_missing';
  else if (healthStatus === 'not_probed') executionStatus = 'blocked_health_unverified';
  else if (healthStatus === 'degraded') executionStatus = 'blocked_health_degraded';
  else if (healthStatus === 'unavailable') executionStatus = 'blocked_health_unavailable';
  else executionStatus = 'ready';

  return {
    connectionStatus,
    authenticationStatus,
    healthStatus,
    executionStatus,
    usable: executionStatus === 'ready',
  };
}
