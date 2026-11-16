import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { phoneLinkRoutes } from './phoneLink.js';

const store = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  redisSet: vi.fn(),
}));
const prismaMock = {
  $queryRawUnsafe: store.query,
  $executeRawUnsafe: store.execute,
  $transaction: store.transaction,
};
const apps: FastifyInstance[] = [];
const deviceId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.decorate('prisma', prismaMock as unknown as PrismaClient);
  app.decorate('redis', { set: store.redisSet } as never);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    if (typeof id === 'string') request.authUser = { id, role: 'user', isOwner: false };
  });
  await app.register(phoneLinkRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.query.mockResolvedValue([]);
  store.execute.mockResolvedValue(1);
  store.redisSet.mockResolvedValue('OK');
  store.transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
});

afterAll(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('RyanAI PhoneLink native device sessions', () => {
  it('keeps the native exchange endpoint independent from browser auth and consumes the code once', async () => {
    store.query
      .mockResolvedValueOnce([{ device_id: deviceId }])
      .mockResolvedValueOnce([{ id: deviceId, device_name: 'Android phone', capabilities: ['comms.receive'] }]);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/phonelink/device-sessions/exchange',
      payload: { exchangeCode: 'a'.repeat(32) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().deviceToken).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect(store.query).toHaveBeenCalledTimes(2);
    expect(store.query.mock.calls[0]?.[0]).toContain('consumed_at = NOW()');
    expect(store.query.mock.calls[1]?.[0]).toContain('device_token_hash');
  });

  it('requires a valid device bearer token for the mobile inbox', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/phonelink/mobile/events' });
    expect(response.statusCode).toBe(401);
    expect(store.query).not.toHaveBeenCalled();
  });

  it('filters inbox events against the device current capability scopes', async () => {
    store.query
      .mockResolvedValueOnce([{ id: deviceId, user_id: 'user-a', capabilities: ['comms.receive'] }])
      .mockResolvedValueOnce([
        { id: '1', eventType: 'comms.dispatch.accepted', title: 'Comms update', body: 'Ready' },
        { id: '2', eventType: 'studio.task.updated', title: 'Studio update', body: 'Ready' },
      ]);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/phonelink/mobile/events',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((event: { id: string }) => event.id)).toEqual(['1']);
    expect(store.execute).toHaveBeenCalled();
  });

  it('requires the separately granted voice.live device capability before issuing a voice ticket', async () => {
    store.query.mockResolvedValueOnce([{ id: deviceId, user_id: 'user-a', capabilities: ['comms.receive'] }]);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/phonelink/mobile/voice-ticket',
      headers: { authorization: `Bearer ${'x'.repeat(43)}`, 'content-type': 'application/json' },
      payload: { language: 'en-ZA' },
    });
    expect(response.statusCode).toBe(403);
    expect(store.redisSet).not.toHaveBeenCalled();
  });

  it('issues a short-lived single-use voice ticket only for a paired device with voice.live', async () => {
    store.query.mockResolvedValueOnce([{ id: deviceId, user_id: 'user-a', capabilities: ['voice.live'] }]);
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/phonelink/mobile/voice-ticket',
      headers: { authorization: `Bearer ${'x'.repeat(43)}`, 'content-type': 'application/json' },
      payload: { language: 'en-ZA' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ expiresIn: 30 });
    expect(response.json().ticket).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(store.redisSet).toHaveBeenCalledWith(
      expect.stringMatching(/^ryanai:realtime-voice:/),
      expect.any(String),
      'EX',
      30,
      'NX',
    );
    const ticketPayload = JSON.parse(store.redisSet.mock.calls[0]?.[1] as string);
    expect(ticketPayload).toMatchObject({
      userId: 'user-a',
      isOwner: false,
      language: 'en-ZA',
      voice: 'ash',
      anniversaryEvolution: true,
      anniversaryYears: expect.any(Number),
      deviceId,
    });
  });

  it('rejects expired or revoked device tokens', async () => {
    store.query.mockResolvedValueOnce([]);
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/phonelink/mobile/events',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('still requires an authenticated RyanAI account to create browser pairing codes', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/phonelink/pairings' });
    expect(response.statusCode).toBe(401);
  });
});
