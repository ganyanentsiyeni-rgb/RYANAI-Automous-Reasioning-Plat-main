import { describe, expect, it } from 'vitest';
import {
  EVENT_SIGNATURE_MAX_SKEW_MS,
  canonicalizeSignedEvent,
  signEventRequest,
  verifyEventRequestSignature,
} from './eventSignature.js';

const secret = 'test-only-secret-that-is-at-least-thirty-two-bytes';
const body = { eventId: 'event-1', payload: { z: 2, a: 1 } };

describe('signed event request contract', () => {
  it('canonicalizes object keys consistently', () => {
    expect(canonicalizeSignedEvent({ b: 2, a: 1 })).toBe(canonicalizeSignedEvent({ a: 1, b: 2 }));
  });

  it('accepts a valid signature within the timestamp window', () => {
    const nowMs = 1_795_000_000_000;
    const timestamp = String(Math.floor(nowMs / 1000));
    const signature = signEventRequest(secret, timestamp, body);
    expect(verifyEventRequestSignature({ secret, timestamp, signature, body, nowMs })).toEqual({ valid: true });
  });

  it('rejects missing and malformed signature headers', () => {
    expect(verifyEventRequestSignature({ secret, timestamp: undefined, signature: undefined, body }))
      .toEqual({ valid: false, reason: 'missing' });
    expect(verifyEventRequestSignature({ secret, timestamp: 'bad', signature: 'bad', body }))
      .toEqual({ valid: false, reason: 'malformed' });
  });

  it('rejects stale timestamps outside the replay window', () => {
    const nowMs = 1_795_000_000_000;
    const timestamp = String(Math.floor((nowMs - EVENT_SIGNATURE_MAX_SKEW_MS - 1) / 1000));
    const signature = signEventRequest(secret, timestamp, body);
    expect(verifyEventRequestSignature({ secret, timestamp, signature, body, nowMs }))
      .toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a modified body even when the signature header is reused', () => {
    const nowMs = 1_795_000_000_000;
    const timestamp = String(Math.floor(nowMs / 1000));
    const signature = signEventRequest(secret, timestamp, body);
    expect(verifyEventRequestSignature({
      secret, timestamp, signature, body: { ...body, payload: { a: 9 } }, nowMs,
    })).toEqual({ valid: false, reason: 'invalid' });
  });
});
