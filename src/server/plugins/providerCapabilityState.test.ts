import { describe, expect, it } from 'vitest';
import { resolveProviderCapabilityState } from './providerCapabilityState.js';

describe('provider capability readiness evidence', () => {
  const now = new Date('2026-11-08T08:00:00.000Z');

  it('blocks a provider with no owner connection', () => {
    expect(resolveProviderCapabilityState('adapter_registered', null, now)).toMatchObject({
      connectionStatus: 'not_connected',
      authenticationStatus: 'not_authenticated',
      healthStatus: 'not_probed',
      executionStatus: 'blocked_connection',
      usable: false,
    });
  });

  it('does not treat an OAuth token exchange as a healthy provider or executable adapter', () => {
    expect(resolveProviderCapabilityState('adapter_required', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
      hasRefreshToken: true,
    }, now)).toMatchObject({
      connectionStatus: 'connected',
      authenticationStatus: 'oauth_grant_issued',
      healthStatus: 'not_probed',
      executionStatus: 'blocked_adapter_missing',
      usable: false,
    });
  });

  it('blocks a registered adapter until an authenticated provider health probe passes', () => {
    expect(resolveProviderCapabilityState('adapter_registered', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
    }, now)).toMatchObject({
      authenticationStatus: 'oauth_grant_issued',
      healthStatus: 'not_probed',
      executionStatus: 'blocked_health_unverified',
      usable: false,
    });
  });

  it('distinguishes expired tokens with refresh from credentials requiring reauthorization', () => {
    const refreshable = resolveProviderCapabilityState('adapter_registered', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T07:59:59.000Z'),
      hasRefreshToken: true,
    }, now, 'healthy');
    expect(refreshable).toMatchObject({ connectionStatus: 'refresh_required', authenticationStatus: 'expired', executionStatus: 'blocked_connection', usable: false });

    const reauthorization = resolveProviderCapabilityState('adapter_registered', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T07:59:59.000Z'),
      hasRefreshToken: false,
    }, now, 'healthy');
    expect(reauthorization).toMatchObject({ connectionStatus: 'reauthorization_required', authenticationStatus: 'reauthorization_required', executionStatus: 'blocked_connection', usable: false });

    const unknown = resolveProviderCapabilityState('adapter_registered', {
      status: 'connected', accessTokenExpiresAt: null,
    }, now, 'healthy');
    expect(unknown).toMatchObject({ connectionStatus: 'expiry_unknown', authenticationStatus: 'expiry_unknown', executionStatus: 'blocked_connection', usable: false });
  });

  it('blocks revoked credentials and degraded provider health', () => {
    const revoked = resolveProviderCapabilityState('adapter_registered', {
      status: 'connected', revokedAt: now,
    }, now, 'healthy');
    expect(revoked).toMatchObject({ connectionStatus: 'revoked', authenticationStatus: 'revoked', executionStatus: 'blocked_revoked', usable: false });

    const degraded = resolveProviderCapabilityState('adapter_registered', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
    }, now, 'degraded');
    expect(degraded).toMatchObject({ executionStatus: 'blocked_health_degraded', usable: false });
  });

  it('marks capability usable only when adapter, owner grant and provider health all pass', () => {
    expect(resolveProviderCapabilityState('adapter_registered', {
      status: 'connected',
      accessTokenExpiresAt: new Date('2026-11-08T09:00:00.000Z'),
    }, now, 'healthy')).toMatchObject({
      authenticationStatus: 'oauth_grant_issued',
      healthStatus: 'healthy',
      executionStatus: 'ready',
      usable: true,
    });
  });
});
