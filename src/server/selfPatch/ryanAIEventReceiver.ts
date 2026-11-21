import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { parseRyanAIEvent } from './ryanAIEventContract.js';
import { ryanAIPaEventBridge } from './ryanAIPaEventBridge.js';

const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_SEEN_EVENTS = 10_000;
const seenEvents = new Map<string, number>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function signRyanAIEventBody(timestamp: string, body: unknown, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${canonicalJson(body)}`).digest('hex');
}

export function verifyRyanAIEventRequest(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  body: unknown;
  secret: string | undefined;
  nowSeconds?: number;
}): boolean {
  const { timestamp, signature, body, secret } = input;
  if (!secret || secret.length < 32 || !timestamp || !/^\d{10}$/.test(timestamp)
    || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const issuedAt = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > MAX_CLOCK_SKEW_SECONDS) return false;
  const expected = Buffer.from(signRyanAIEventBody(timestamp, body, secret), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function pruneSeenEvents(now: number): void {
  for (const [id, seenAt] of seenEvents) {
    if (now - seenAt > MAX_CLOCK_SKEW_SECONDS) seenEvents.delete(id);
  }
  while (seenEvents.size >= MAX_SEEN_EVENTS) {
    const oldest = seenEvents.keys().next().value as string | undefined;
    if (!oldest) break;
    seenEvents.delete(oldest);
  }
}

/**
 * Authenticated internal event ingress. Requires an already-provisioned
 * RYANAI_EVENT_HMAC_SECRET; this code never creates or changes secrets.
 * Sign: HMAC-SHA256(secret, timestamp + "." + canonical-JSON(body)).
 */
export const ryanAIEventReceiverPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/internal/ryanai/events', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const secret = process.env.RYANAI_EVENT_HMAC_SECRET;
    if (!secret || secret.length < 32) {
      return reply.code(503).send({ accepted: false, state: 'not_configured' });
    }

    const timestamp = request.headers['x-ryanai-timestamp'];
    const signature = request.headers['x-ryanai-signature'];
    if (typeof timestamp !== 'string' || typeof signature !== 'string'
      || !verifyRyanAIEventRequest({ timestamp, signature, body: request.body, secret })) {
      return reply.code(401).send({ accepted: false, state: 'unauthorized' });
    }

    const event = parseRyanAIEvent(request.body);
    if (!event) return reply.code(400).send({ accepted: false, state: 'invalid_event' });

    // Do not acknowledge or mark an event as seen until the PA observer is attached.
    // The API listener can start accepting requests before PA finishes booting.
    if (ryanAIPaEventBridge.listenerCount('event') === 0) {
      return reply.code(503).send({ accepted: false, state: 'observer_unavailable' });
    }

    const now = Math.floor(Date.now() / 1000);
    pruneSeenEvents(now);
    if (seenEvents.has(event.eventId)) {
      return reply.code(202).send({ accepted: true, duplicate: true, state: 'already_observed' });
    }
    seenEvents.set(event.eventId, now);
    ryanAIPaEventBridge.publish(event);
    request.log.info({
      eventType: event.eventType,
      eventId: event.eventId,
      correlationId: event.correlationId,
      source: event.source,
      state: event.eventType === 'comms.delivery.receipt' ? event.state : event.severity,
    }, 'Authenticated RyanAI event delivered to PA observer');
    return reply.code(202).send({ accepted: true, duplicate: false, state: 'observed' });
  });
};
