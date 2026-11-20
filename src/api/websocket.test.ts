import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcast, publishRealtimeEvent, registerWebSocketRoutes } from './websocket';

vi.mock('../server/routes/auth.js', () => ({ requireAdmin: vi.fn() }));
const { appendRealtimeEvent, replayRealtimeEvents } = vi.hoisted(() => ({ appendRealtimeEvent: vi.fn(), replayRealtimeEvents: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../server/realtime/eventStore.js', () => ({
  appendRealtimeEvent: (...args: unknown[]) => appendRealtimeEvent(...args),
  replayRealtimeEvents: (...args: unknown[]) => replayRealtimeEvents(...args),
}));
vi.mock('../shared/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = this.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

let connect: (socket: Socket, request: FastifyRequest) => Promise<void>;
let sockets: Socket[];
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  sockets = [];
  appendRealtimeEvent.mockReset();
  replayRealtimeEvents.mockReset();
  replayRealtimeEvents.mockResolvedValue({ events: [], nextCursor: 0n, hasMore: false, cursorExpired: false, resyncRequired: false });
  const app = {
    rateLimit: vi.fn(() => vi.fn()),
    get: vi.fn((_path, _options, handler) => {
      connect = handler;
    }),
  };
  await registerWebSocketRoutes(app as unknown as FastifyInstance);
});
afterEach(() => {
  for (const socket of sockets) socket.close();
  vi.useRealTimers();
});

async function openSocket() {
  const socket = new Socket();
  sockets.push(socket);
  await connect(socket, {
    authUser: {
      id: 'verified-admin',
      email: 'admin@example.test',
      role: 'admin',
    },
  } as FastifyRequest);
  return socket;
}

async function request(socket: Socket, channel: string, data?: unknown) {
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({ id: 'request-1', type: 'request', channel, data }),
    ),
  );
  await Promise.resolve();
}

describe('WebSocket session and message boundaries', () => {
  it('requires reauthentication at exactly five minutes', async () => {
    const socket = await openSocket();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(socket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(
      1008,
      'Reauthenticate',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels expiry when the client disconnects', async () => {
    const socket = await openSocket();
    socket.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('accepts 60 messages, closes on the 61st, and ignores further messages', async () => {
    const socket = await openSocket();
    for (let index = 0; index < 60; index++)
      await request(socket, 'auth.verify');
    expect(socket.send).toHaveBeenCalledTimes(60);
    expect(socket.close).not.toHaveBeenCalled();
    await request(socket, 'auth.verify');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({
      type: 'error',
      error: { code: 'RATE_LIMITED' },
    });
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(
      1008,
      'Message rate limit exceeded',
    );
    await request(socket, 'auth.verify');
    expect(socket.send).toHaveBeenCalledTimes(61);
  });

  it('resets the budget at exactly one minute and keeps budgets independent per client', async () => {
    const first = await openSocket();
    const second = await openSocket();
    for (let index = 0; index < 60; index++)
      await request(first, 'auth.verify');
    await request(second, 'auth.verify');
    expect(second.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await request(first, 'auth.verify');
    expect(first.close).not.toHaveBeenCalled();
    expect(JSON.parse(first.send.mock.calls.at(-1)![0])).toMatchObject({
      data: { authenticated: true, userId: 'verified-admin' },
    });
  });

  it('counts malformed messages toward the rate limit', async () => {
    const socket = await openSocket();
    for (let index = 0; index < 60; index++)
      socket.emit('message', Buffer.from('{'));
    expect(socket.send).toHaveBeenCalledTimes(60);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      error: { code: 'PARSE_ERROR' },
    });
    await request(socket, 'auth.verify');
    expect(socket.close).toHaveBeenCalledWith(
      1008,
      'Message rate limit exceeded',
    );
  });

  it.each([undefined, null, 'metrics', {}, { channel: 42 }])(
    'rejects invalid subscription data (%j) without closing the connection',
    async (data) => {
      const socket = await openSocket();
      await request(socket, 'subscribe', data);
      expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
        id: 'request-1',
        type: 'response',
        error: {
          code: 'HANDLER_ERROR',
          message: 'A subscription channel is required',
        },
      });
      broadcast('system.metrics', { cpu: 1 });
      expect(socket.send).toHaveBeenCalledOnce();
      expect(socket.close).not.toHaveBeenCalled();
    },
  );

  it('delivers broadcasts once to subscribers and removes disconnected subscriptions', async () => {
    const subscribed = await openSocket();
    const other = await openSocket();
    await request(subscribed, 'subscribe', { channel: 'system.metrics' });
    await request(subscribed, 'subscribe', { channel: 'metrics' });
    subscribed.send.mockClear();
    broadcast('system.metrics', { cpu: 0 });
    expect(subscribed.send).toHaveBeenCalledOnce();
    expect(JSON.parse(subscribed.send.mock.calls[0][0])).toMatchObject({
      type: 'event',
      channel: 'system.metrics',
      data: { cpu: 0 },
    });
    expect(other.send).not.toHaveBeenCalled();
    subscribed.close();
    // A late broadcast must not reach a removed connection, even if a stale
    // transport reference still reports OPEN.
    subscribed.readyState = subscribed.OPEN;
    broadcast('system.metrics', { cpu: 1 });
    expect(subscribed.send).toHaveBeenCalledOnce();
  });

  it('replays only the authenticated user audience and returns a string cursor', async () => {
    replayRealtimeEvents.mockResolvedValue({
      events: [{ id: 'event-1', sequence: 7n, eventType: 'task.updated', payload: { taskId: 'task-1' }, createdAt: new Date('2026-01-01T00:00:00Z') }],
      nextCursor: 7n, hasMore: false, cursorExpired: false, resyncRequired: false,
    });
    const socket = await openSocket();
    await request(socket, 'subscribe', { channel: 'tasks.updates', afterSequence: '6' });
    expect(replayRealtimeEvents).toHaveBeenCalledWith({}, {
      audience: { type: 'user', id: 'verified-admin' }, channel: 'tasks.updates', afterSequence: 6n, limit: 50,
    });
    const replayed = socket.send.mock.calls.map(call => JSON.parse(call[0]));
    expect(replayed).toContainEqual(expect.objectContaining({ type: 'event', channel: 'tasks.updates', data: expect.objectContaining({ sequence: '7', eventType: 'task.updated' }) }));
    expect(replayed.at(-1)).toMatchObject({ type: 'response', data: { subscribed: 'tasks.updates', replayed: 1, nextCursor: '7' } });
  });

  it('persists a user event before delivering it to that user subscribers', async () => {
    const socket = await openSocket();
    await request(socket, 'subscribe', { channel: 'tasks.updates' });
    socket.send.mockClear();
    appendRealtimeEvent.mockResolvedValue({
      id: 'event-2', sequence: 1n, eventType: 'task.created', payload: { taskId: 'task-2' }, createdAt: new Date('2026-01-01T00:00:01Z'),
    });
    const result = await publishRealtimeEvent({ userId: 'verified-admin', channel: 'tasks.updates', eventType: 'task.created', payload: { taskId: 'task-2' } });
    expect(appendRealtimeEvent).toHaveBeenCalledWith({}, {
      audience: { type: 'user', id: 'verified-admin' }, channel: 'tasks.updates', eventType: 'task.created', payload: { taskId: 'task-2' },
    });
    expect(result).toEqual({ id: 'event-2', sequence: '1' });
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'event', data: { sequence: '1', eventType: 'task.created' } });
  });

  it('requests full resynchronization when the replay cursor has expired', async () => {
    replayRealtimeEvents.mockResolvedValue({ events: [], nextCursor: 3n, hasMore: false, cursorExpired: true, resyncRequired: true });
    const socket = await openSocket();
    await request(socket, 'subscribe', { channel: 'tasks.updates', afterSequence: '0' });
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'response', data: { cursorExpired: true, resyncRequired: true, nextCursor: '3' } });
  });

});
