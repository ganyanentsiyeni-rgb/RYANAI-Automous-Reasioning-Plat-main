import { describe, expect, it, vi } from 'vitest';
import type { RyanAiPostgresQuery } from '../lib/postgresGitHubEventIdempotencyStore.js';
import {
  createPostgresGitHubOwnerEventNotifier,
  createPostgresGitHubOwnerEventWakeSource,
  startPostgresGitHubOwnerEventWorker,
  RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL,
} from './postgresGitHubOwnerEventWakeSource.js';

describe('PostgreSQL GitHub owner wake adapters', () => {
  it('publishes a parameterized wake hint on the fixed channel', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const notify = createPostgresGitHubOwnerEventNotifier(query as RyanAiPostgresQuery);
    await notify('event-123');
    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL,
      JSON.stringify({ version: 1, eventId: 'event-123' }),
    ]);
  });

  it('rejects empty event identifiers before querying PostgreSQL', async () => {
    const query = vi.fn();
    const notify = createPostgresGitHubOwnerEventNotifier(query as RyanAiPostgresQuery);
    await expect(notify('  ')).rejects.toThrow(/eventId/);
    expect(query).not.toHaveBeenCalled();
  });

  it('listens on the fixed owner channel and treats notification contents as opaque', async () => {
    let notification: ((payload: string) => void) | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async (channel: string, callback: (payload: string) => void) => {
      notification = callback;
      return unsubscribe;
    });
    const onWake = vi.fn();
    const onError = vi.fn();
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);

    const stop = source.subscribe(onWake);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, expect.any(Function));
    notification?.('not-json-and-not-trusted');
    expect(onWake).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    notification?.('late-notification');
    expect(onWake).toHaveBeenCalledOnce();
  });

  it('unsubscribes if stopped while LISTEN setup is pending', async () => {
    let resolveListen: ((unsubscribe: () => Promise<void>) => void) | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(() => new Promise<() => Promise<void>>((resolve) => {
      resolveListen = resolve;
    }));
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, vi.fn());

    const stop = source.subscribe(vi.fn());
    stop();
    resolveListen?.(unsubscribe);
    await Promise.resolve();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports listener setup failures', async () => {
    const setupError = new Error('LISTEN unavailable');
    const onError = vi.fn();
    const listen = vi.fn().mockRejectedValue(setupError);
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);
    source.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(setupError);
  });

  it('reports asynchronous unsubscribe failures', async () => {
    const cleanupError = new Error('UNLISTEN failed');
    const onError = vi.fn();
    const listen = vi.fn().mockResolvedValue(() => Promise.reject(cleanupError));
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);
    const stop = source.subscribe(vi.fn());
    await Promise.resolve();
    stop();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(cleanupError);
  });
  it('composes the PostgreSQL listener with the owner-scoped worker', async () => {
    let notification: (() => void) | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async (_channel: string, callback: () => void) => {
      notification = callback;
      return unsubscribe;
    });
    const listOwners = vi.fn().mockResolvedValue([]);
    const registry = { supportedEventTypes: () => ['github.pull_request'] };
    const inbox = { processNextForOwner: vi.fn().mockResolvedValue({ status: 'idle' }) };
    const onError = vi.fn();

    const stop = startPostgresGitHubOwnerEventWorker(
      { listen },
      inbox as never,
      registry as never,
      listOwners,
      { workerId: 'github-owner-worker', onError },
    );
    await Promise.resolve();
    notification?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(listOwners).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

});
