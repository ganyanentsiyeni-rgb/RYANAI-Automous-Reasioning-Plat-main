import { describe, expect, it, vi } from 'vitest';
import { probeAuthenticatedProvider, readStoredProviderHealthEvidence } from './providerHealth.js';

describe('probeAuthenticatedProvider', () => {
  it('records a healthy result without exposing the access token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const token = 'secret-access-token';

    const result = await probeAuthenticatedProvider('gmail', token, fetchImpl);

    expect(result.status).toBe('healthy');
    expect(result.safeNote).not.toContain(token);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ' + token }),
      }),
    );
  });

  it('classifies provider authorization rejection as unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const result = await probeAuthenticatedProvider('google-calendar', 'token', fetchImpl);
    expect(result.status).toBe('unavailable');
  });

  it('classifies rate limits and server errors as degraded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    const result = await probeAuthenticatedProvider('microsoft-365-calendar', 'token', fetchImpl);
    expect(result.status).toBe('degraded');
  });

  it('never treats unsupported providers as healthy', async () => {
    await expect(probeAuthenticatedProvider('unknown-provider', 'token', vi.fn())).rejects.toThrow(
      'not supported',
    );
  });
});

describe('readStoredProviderHealthEvidence', () => {
  it('fails closed for missing or malformed metadata', () => {
    expect(readStoredProviderHealthEvidence(null)).toMatchObject({ status: 'not_probed' });
    expect(readStoredProviderHealthEvidence({ health: { status: 'healthy', checkedAt: '2026-11-25T03:00:00.000Z', latencyMs: 42 } }))
      .toMatchObject({ status: 'healthy', latencyMs: 42 });
    expect(readStoredProviderHealthEvidence({ health: { status: 'bogus' } }))
      .toMatchObject({ status: 'not_probed' });
  });
});
