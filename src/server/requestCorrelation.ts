import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Return a bounded, non-empty correlation ID for an HTTP request.
 * Caller-provided IDs are accepted only when they match the transport-safe
 * correlation format; otherwise a fresh UUID is generated.
 */
export function resolveRequestCorrelationId(headers: IncomingHttpHeaders): string {
  const raw = headers['x-request-id'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof candidate === 'string'
    && candidate.length >= 8
    && candidate.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(candidate)
  ) {
    return candidate;
  }
  return randomUUID();
}
