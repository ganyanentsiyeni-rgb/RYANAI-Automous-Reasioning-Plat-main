import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ryanAIEventReceiverPlugin, signRyanAIEventBody, verifyRyanAIEventRequest } from './ryanAIEventReceiver.js';
import { ryanAIPaEventBridge } from './ryanAIPaEventBridge.js';

const secret = 'test-only-secret-material-at-least-32-bytes';
const body = {
  schemaVersion: 1,
  eventType: 'selfpatch.audit.finding',
  source: 'ryanai-self-patch',
  repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
  commitSha: 'a'.repeat(40),
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  correlationId: 'correlation-id-0001',
  occurredAt: '2026-11-21T12:00:00Z',
  severity: 'warning',
  findingCode: 'ci.required_check_missing',
};

describe('RyanAI authenticated event receiver signature', () => {
  it('accepts a valid canonical HMAC within the timestamp window', () => {
    const timestamp = '1795262400';
    const signature = signRyanAIEventBody(timestamp, body, secret);
    expect(verifyRyanAIEventRequest({ timestamp, signature, body, secret, nowSeconds: 1795262400 })).toBe(true);
  });

  it('rejects modified bodies and invalid signatures', () => {
    const timestamp = '1795262400';
    const signature = signRyanAIEventBody(timestamp, body, secret);
    expect(verifyRyanAIEventRequest({ timestamp, signature, body: { ...body, severity: 'critical' }, secret, nowSeconds: 1795262400 })).toBe(false);
    expect(verifyRyanAIEventRequest({ timestamp, signature: '0'.repeat(64), body, secret, nowSeconds: 1795262400 })).toBe(false);
  });

  it('rejects stale timestamps and missing or short secrets', () => {
    const timestamp = '1795262400';
    const signature = signRyanAIEventBody(timestamp, body, secret);
    expect(verifyRyanAIEventRequest({ timestamp, signature, body, secret, nowSeconds: 1795262801 })).toBe(false);
    expect(verifyRyanAIEventRequest({ timestamp, signature, body, secret: 'short', nowSeconds: 1795262400 })).toBe(false);
    expect(verifyRyanAIEventRequest({ timestamp, signature, body, secret: undefined, nowSeconds: 1795262400 })).toBe(false);
  });
});


describe('RyanAI authenticated event receiver delivery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not acknowledge or consume an event until the PA observer is attached', async () => {
    vi.stubEnv('RYANAI_EVENT_HMAC_SECRET', secret);
    const app = Fastify();
    await app.register(ryanAIEventReceiverPlugin);
    await app.ready();

    const event = {
      ...body,
      eventId: '223e4567-e89b-42d3-a456-426614174000',
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'x-ryanai-timestamp': timestamp,
      'x-ryanai-signature': signRyanAIEventBody(timestamp, event, secret),
    };

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/internal/ryanai/events',
      headers,
      payload: event,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      accepted: false,
      state: 'observer_unavailable',
    });

    const observed = vi.fn();
    ryanAIPaEventBridge.on('event', observed);
    try {
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/internal/ryanai/events',
        headers,
        payload: event,
      });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        state: 'observed',
      });
      expect(observed).toHaveBeenCalledOnce();

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/internal/ryanai/events',
        headers,
        payload: event,
      });
      expect(duplicate.statusCode).toBe(202);
      expect(duplicate.json()).toMatchObject({
        accepted: true,
        duplicate: true,
        state: 'already_observed',
      });
      expect(observed).toHaveBeenCalledOnce();
    } finally {
      ryanAIPaEventBridge.off('event', observed);
      await app.close();
    }
  });
});
