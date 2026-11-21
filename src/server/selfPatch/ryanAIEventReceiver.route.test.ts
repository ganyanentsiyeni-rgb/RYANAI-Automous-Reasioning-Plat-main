import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ryanAIEventReceiverPlugin, signRyanAIEventBody } from './ryanAIEventReceiver.js';
import { ryanAIPaEventBridge } from './ryanAIPaEventBridge.js';

const secret = 'route-test-secret-material-at-least-32-bytes-long';
const applications: FastifyInstance[] = [];

function event(eventId: string) {
  return {
    schemaVersion: 1,
    eventType: 'selfpatch.audit.finding',
    source: 'ryanai-self-patch',
    repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
    commitSha: 'a'.repeat(40),
    eventId,
    correlationId: 'route-test-correlation-0001',
    occurredAt: new Date().toISOString(),
    severity: 'warning',
    findingCode: 'ci.required_check_missing',
  };
}

async function postEvent(body: unknown, configuredSecret: string | undefined = secret) {
  if (configuredSecret === undefined) delete process.env.RYANAI_EVENT_HMAC_SECRET;
  else process.env.RYANAI_EVENT_HMAC_SECRET = configuredSecret;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRyanAIEventBody(timestamp, body, secret);
  const app = Fastify();
  applications.push(app);
  await app.register(ryanAIEventReceiverPlugin);
  return app.inject({
    method: 'POST',
    url: '/api/internal/ryanai/events',
    payload: body,
    headers: {
      'x-ryanai-timestamp': timestamp,
      'x-ryanai-signature': signature,
    },
  });
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  delete process.env.RYANAI_EVENT_HMAC_SECRET;
  vi.restoreAllMocks();
});

describe('RyanAI authenticated event receiver route', () => {
  it('fails closed when the HMAC secret is not configured', async () => {
    const response = await postEvent(event('123e4567-e89b-42d3-a456-426614174101'), undefined);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ accepted: false, state: 'not_configured' });
  });

  it('rejects an invalid event even when its transport signature is valid', async () => {
    const invalid = { ...event('123e4567-e89b-42d3-a456-426614174102'), recipient: '+15555550123' };
    const response = await postEvent(invalid);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ accepted: false, state: 'invalid_event' });
  });

  it('forwards a valid authenticated event to PA exactly once and suppresses retries', async () => {
    const received = vi.fn();
    ryanAIPaEventBridge.on('event', received);
    const body = event('123e4567-e89b-42d3-a456-426614174103');
    try {
      const first = await postEvent(body);
      const retry = await postEvent(body);
      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({ accepted: true, duplicate: false, state: 'observed' });
      expect(retry.statusCode).toBe(202);
      expect(retry.json()).toMatchObject({ accepted: true, duplicate: true, state: 'already_observed' });
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0][0]).toMatchObject({
        eventType: 'selfpatch.audit.finding',
        source: 'ryanai-self-patch',
        findingCode: 'ci.required_check_missing',
      });
    } finally {
      ryanAIPaEventBridge.off('event', received);
    }
  });
});
