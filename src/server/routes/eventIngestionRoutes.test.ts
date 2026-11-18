import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signEventRequest } from '../../events/eventSignature.js';
import { eventIngestionRoutes } from './eventIngestionRoutes.js';

const secret = 'test-only-secret-that-is-at-least-thirty-two-bytes';
const event = {
  eventId: '0b6b3c54-2d9a-4e25-8e14-8d4e4b1dfc01',
  eventType: 'tapmap.connection.observed',
  schemaVersion: 1,
  occurredAt: '2026-11-18T12:00:00.000Z',
  source: { provider: 'tapmap', service: 'desktop-agent' },
  idempotencyKey: 'tapmap:connection:123',
  classification: 'internal',
  payload: { remoteIp: '203.0.113.8', port: 443 },
};

afterEach(() => {
  delete process.env.RYANAI_EVENT_INGESTION_SECRET;
});

async function makeServer(enqueue = vi.fn().mockResolvedValue({
  duplicate: false, event: { eventId: event.eventId },
})) {
  const app = Fastify();
  app.decorate('prisma', { intelligenceEventInbox: {} } as never);
  const enqueueSpy = vi.spyOn(
    (await import('../../events/intelligenceEventInbox.js')).IntelligenceEventInbox.prototype,
    'enqueue',
  ).mockImplementation(enqueue);
  await app.register(eventIngestionRoutes);
  await app.ready();
  return { app, enqueue, enqueueSpy };
}

describe('signed event ingestion route', () => {
  it('rejects requests when the signing secret is not configured', async () => {
    const { app, enqueueSpy } = await makeServer();
    const response = await app.inject({ method: 'POST', url: '/api/events/ingest', payload: event });
    expect(response.statusCode).toBe(503);
    expect(enqueueSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unsigned or modified requests before persistence', async () => {
    process.env.RYANAI_EVENT_INGESTION_SECRET = secret;
    const { app, enqueueSpy } = await makeServer();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signEventRequest(secret, timestamp, event);
    const response = await app.inject({
      method: 'POST', url: '/api/events/ingest',
      headers: { 'x-ryanai-timestamp': timestamp, 'x-ryanai-signature': signature },
      payload: { ...event, payload: { altered: true } },
    });
    expect(response.statusCode).toBe(401);
    expect(enqueueSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts a valid signed event and reports duplicate deliveries', async () => {
    process.env.RYANAI_EVENT_INGESTION_SECRET = secret;
    const { app, enqueue, enqueueSpy } = await makeServer();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signEventRequest(secret, timestamp, event);
    const response = await app.inject({
      method: 'POST', url: '/api/events/ingest',
      headers: { 'x-ryanai-timestamp': timestamp, 'x-ryanai-signature': signature },
      payload: event,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'accepted', eventId: event.eventId });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    enqueue.mockResolvedValueOnce({ duplicate: true, event: { eventId: event.eventId } });
    const duplicate = await app.inject({
      method: 'POST', url: '/api/events/ingest',
      headers: { 'x-ryanai-timestamp': timestamp, 'x-ryanai-signature': signature },
      payload: event,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ status: 'duplicate' });
    await app.close();
  });
});
