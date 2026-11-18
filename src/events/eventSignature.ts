import { createHmac, timingSafeEqual } from 'node:crypto';

export const EVENT_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export type EventSignatureFailure = 'missing' | 'malformed' | 'expired' | 'invalid';

export type EventSignatureVerification =
  | { valid: true }
  | { valid: false; reason: EventSignatureFailure };

/** Stable JSON representation used for signatures across runtimes. */
export function canonicalizeSignedEvent(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalizeSignedEvent).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return '{' + entries.map(([key, item]) =>
    JSON.stringify(key) + ':' + canonicalizeSignedEvent(item)
  ).join(',') + '}';
}

/** Create the SHA-256 signature expected by the machine-to-machine ingestion route. */
export function signEventRequest(secret: string, timestampSeconds: string, body: unknown): string {
  return 'sha256=' + createHmac('sha256', secret)
    .update(timestampSeconds + '.' + canonicalizeSignedEvent(body), 'utf8')
    .digest('hex');
}

/**
 * Verify a timestamped HMAC signature. The timestamp bounds replay exposure;
 * eventId/provider idempotency in the inbox handles retries within that window.
 */
export function verifyEventRequestSignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: unknown;
  nowMs?: number;
}): EventSignatureVerification {
  const { secret, timestamp, signature, body } = input;
  if (!timestamp || !signature) return { valid: false, reason: 'missing' };
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return { valid: false, reason: 'malformed' };
  }
  const timestampMs = Number(timestamp) * 1000;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > EVENT_SIGNATURE_MAX_SKEW_MS) {
    return { valid: false, reason: 'expired' };
  }
  const expected = Buffer.from(signEventRequest(secret, timestamp, body).slice(7), 'hex');
  const supplied = Buffer.from(signature.slice(7), 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return { valid: false, reason: 'invalid' };
  }
  return { valid: true };
}
