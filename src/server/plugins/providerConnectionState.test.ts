import { describe, expect, it } from 'vitest';
import { describeProviderConnectionState } from './providerConnectionState.js';

describe('provider connection state reporting', () => {
  const now = new Date('2026-11-08T10:00:00.000Z');

  it('does not equate a connected OAuth record with verified provider health', () => {
    expect(describeProviderConnectionState({
      status: 'connected', accessTokenExpiresAt: new Date('2026-11-08T11:00:00.000Z'),
      hasRefreshToken: true,
    }, now)).toMatchObject({
      connectionState: 'connected',
      credentialState: 'access_token_valid_or_expiry_unknown',
      healthState: 'not_probed',
      lastHealthCheckAt: null,
    });
  });

  it('distinguishes expired access tokens that still have a refresh grant', () => {
    expect(describeProviderConnectionState({
      status: 'connected', accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
      hasRefreshToken: true,
    }, now).credentialState).toBe('access_expired_refresh_available');
  });

  it('requires reauthorization when an expired access token has no refresh grant', () => {
    expect(describeProviderConnectionState({
      status: 'connected', accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
      hasRefreshToken: false,
    }, now).credentialState).toBe('access_expired_reauthorization_required');
  });

  it('preserves explicit reauthorization and pending revocation states', () => {
    expect(describeProviderConnectionState({ status: 'reauthorization_required', hasRefreshToken: false }, now).credentialState).toBe('reauthorization_required');
    expect(describeProviderConnectionState({ status: 'revocation_pending', hasRefreshToken: false }, now).credentialState).toBe('revocation_pending');
  });

  it('never reports an unknown or disconnected status as connected', () => {
    expect(describeProviderConnectionState({ status: 'unknown', hasRefreshToken: false }, now).credentialState).toBe('disconnected');
  });
});
