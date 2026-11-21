import { describe, expect, it } from 'vitest';
import { signRyanAIEventBody, verifyRyanAIEventRequest } from './ryanAIEventReceiver.js';

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
