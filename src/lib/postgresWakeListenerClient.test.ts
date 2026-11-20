import { describe, expect, it, vi } from 'vitest';
import {
  createRyanAiPostgresWakeListener,
  type RyanAiPgListenerClient,
  type RyanAiPgNotification,
} from './postgresWakeListenerClient.js';
import { createPostgresGitHubOwnerEventNotifier, RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, startPostgresGitHubOwnerEventWorker } from '../events/postgresGitHubOwnerEventWakeSource.js';
import { enqueueRyanAiGitHubOwnerBoundEvent } from '../events/githubOwnerBoundEvent.js';

function fakeClient() {
  const listeners = new Set<(message: RyanAiPgNotification) => void>();
  const query = vi.fn(async (_sql: string) => undefined);
  const on = vi.fn((_event: 'notification', listener: (message: RyanAiPgNotification) => void) => {
    listeners.add(listener);
  });
  const off = vi.fn((_event: 'notification', listener: (message: RyanAiPgNotification) => void) => {
    listeners.delete(listener);
  });
  const end = vi.fn(async () => undefined);
  return {
    client: { query, on, off, end } as RyanAiPgListenerClient,
    query,
    on,
    off,
    end,
    emit(message: RyanAiPgNotification) {
      for (const listener of listeners) listener(message);
    },
  };
}

describe('concrete PostgreSQL wake listener client', () => {
  it('LISTENs on the fixed owner channel and forwards only matching-channel wake signals', async () => {
    const fake = fakeClient();
    const receive = vi.fn();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    const stop = await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, receive);

    expect(fake.query).toHaveBeenCalledWith(`LISTEN "${RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL}"`);
    fake.emit({ channel: 'unrelated_channel', payload: 'ignore' });
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: 'opaque-untrusted-payload' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith('opaque-untrusted-payload');

    await stop();
    expect(fake.query).toHaveBeenLastCalledWith(`UNLISTEN "${RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL}"`);
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: 'late' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(fake.end).not.toHaveBeenCalled();
  });

  it('rejects arbitrary channel names before issuing SQL', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    await expect(listener.listen('owner"; DROP TABLE users; --', vi.fn()))
      .rejects.toThrow('Unsupported RyanAI PostgreSQL wake channel');
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.on).not.toHaveBeenCalled();
  });

  it('removes the event handler if LISTEN setup fails', async () => {
    const fake = fakeClient();
    const setupError = new Error('connection unavailable');
    fake.query.mockRejectedValueOnce(setupError);
    const listener = createRyanAiPostgresWakeListener(fake.client);
    await expect(listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, vi.fn()))
      .rejects.toBe(setupError);
    expect(fake.on).toHaveBeenCalledOnce();
    expect(fake.off).toHaveBeenCalledOnce();
  });

  it('closes the dedicated client only when ownership is explicitly transferred', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client, { closeClientOnStop: true });
    const stop = await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, vi.fn());
    await stop();
    await stop();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('wakes the owner-scoped worker through the concrete listener adapter', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    const listOwners = vi.fn().mockResolvedValue(['owner-1']);
    const inbox = { processNextForOwner: vi.fn().mockResolvedValue({ status: 'idle' }) };
    const registry = { supportedEventTypes: () => ['github.pull_request'] };
    const onError = vi.fn();
    const stop = startPostgresGitHubOwnerEventWorker(
      listener, inbox as never, registry as never, listOwners,
      { workerId: 'owner-worker', onError },
    );
    await Promise.resolve();
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: 'untrusted payload is ignored' });
    await Promise.resolve();
    await Promise.resolve();
    expect(listOwners).toHaveBeenCalledOnce();
    expect(inbox.processNextForOwner).toHaveBeenCalledWith(
      'owner-worker', 'owner-1', expect.any(Function), expect.any(Date), ['github.pull_request'],
    );
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it('moves an owner-bound event from enqueue through NOTIFY, LISTEN, and owner-scoped dispatch', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    const persisted: unknown[] = [];
    const order: string[] = [];
    const eventEnvelope = {
      eventId: '11111111-1111-5111-8111-111111111111',
      eventType: 'github.pull_request',
      schemaVersion: 1,
      occurredAt: '2026-11-19T12:00:00.000Z',
      source: { provider: 'github', service: 'event-streams' },
      idempotencyKey: 'github:12345:evt-1',
      classification: 'confidential',
      payload: {
        owner: { userId: 'owner-1', githubUserId: 'gh-1', repositoryId: '12345', repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' },
        githubEvent: { id: 'evt-1', type: 'pull_request', repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main', occurredAt: '2026-11-19T12:00:00.000Z', payload: {} },
      },
    };
    const registry = {
      supportedEventTypes: () => ['github.pull_request'],
      dispatch: vi.fn(async (_event: typeof eventEnvelope) => undefined),
    };
    const inbox = {
      enqueue: vi.fn(async (envelope: unknown) => {
        persisted.push(envelope);
        order.push('enqueue-committed');
        return { event: {}, duplicate: false };
      }),
      processNextForOwner: vi.fn(async (_worker: string, owner: string, handler: (event: typeof eventEnvelope) => Promise<void>) => {
        const stored = persisted.find((item) => (item as typeof eventEnvelope).payload.owner.userId === owner) as typeof eventEnvelope;
        if (!stored || registry.dispatch.mock.calls.length > 0) return { status: 'idle' as const };
        await handler(stored);
        return { status: 'processed' as const, eventId: stored.eventId };
      }),
    };
    const listOwners = vi.fn().mockResolvedValue(['owner-1']);
    const stop = startPostgresGitHubOwnerEventWorker(
      listener, inbox as never, registry as never, listOwners,
      { workerId: 'integration-worker' },
    );
    const notifier = createPostgresGitHubOwnerEventNotifier(async (sql, params) => {
      expect(sql).toBe('SELECT pg_notify($1, $2)');
      expect(params?.[0]).toBe(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL);
      order.push('notify-after-commit');
      fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: String(params?.[1] ?? '') });
      return [];
    });

    try {
      await enqueueRyanAiGitHubOwnerBoundEvent(
        inbox as never,
        'owner-1',
        async (userId) => ({
          userId,
          githubUserId: 'gh-1',
          repositoryId: '12345',
          repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
        }),
        {
          id: 'evt-1',
          type: 'pull_request',
          repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
          occurredAt: '2026-11-19T12:00:00.000Z',
          payload: {
            repository: { id: 12345, full_name: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' },
            action: 'opened',
          },
        },
        notifier,
      );
      await vi.waitFor(() => expect(registry.dispatch).toHaveBeenCalledOnce());
      expect(order).toEqual(['enqueue-committed', 'notify-after-commit']);
      expect(listOwners).toHaveBeenCalledOnce();
      expect(inbox.processNextForOwner).toHaveBeenCalledOnce();
      expect(registry.dispatch.mock.calls[0][0].payload.owner.userId).toBe('owner-1');
    } finally {
      stop();
    }
  });

  it('reports asynchronous consumer failures without leaking an unhandled rejection', async () => {
    const fake = fakeClient();
    const error = new Error('consumer failed');
    const onError = vi.fn();
    const listener = createRyanAiPostgresWakeListener(fake.client, { onError });
    await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, async () => {
      throw error;
    });
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: '{}' });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
