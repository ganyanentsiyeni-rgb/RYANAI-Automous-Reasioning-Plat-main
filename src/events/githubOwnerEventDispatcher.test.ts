import { describe, expect, it, vi } from 'vitest';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';
import { dispatchNextGitHubEventForAuthorizedOwners, startGitHubOwnerEventWorker } from './githubOwnerEventDispatcher.js';
import type { RyanAIEventEnvelope } from './eventContract.js';

const event: RyanAIEventEnvelope = {
  eventId: '0b6b3c54-2d9a-4e25-8e14-8d4e4b1dfc01',
  eventType: 'github.pull_request',
  schemaVersion: 1,
  occurredAt: '2026-11-19T12:00:00.000Z',
  source: { provider: 'github', service: 'event-streams' },
  idempotencyKey: 'github:repo-1:event-1',
  classification: 'confidential',
  payload: { owner: { userId: 'owner-a' }, githubEvent: { payload: { ownerUserId: 'owner-b' } } },
};

describe('dispatchNextGitHubEventForAuthorizedOwners', () => {
  it('dispatches one event per trusted owner context and deduplicates owner IDs', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry = new EventHandlerRegistry();
    registry.register('github.pull_request', handler);
    const processNextForOwner = vi.fn(async (_worker, owner, callback) => {
      if (owner === 'owner-a') await callback(event);
      return { status: owner === 'owner-a' ? 'processed' as const : 'idle' as const, ...(owner === 'owner-a' ? { eventId: event.eventId } : {}) };
    });
    const listOwners = vi.fn().mockResolvedValue(['owner-a', 'owner-a', ' owner-b ', '']);
    const results = await dispatchNextGitHubEventForAuthorizedOwners(
      { processNextForOwner } as never, registry, listOwners, 'github-worker',
    );
    expect(processNextForOwner).toHaveBeenCalledTimes(2);
    expect(processNextForOwner).toHaveBeenNthCalledWith(1, 'github-worker', 'owner-a', expect.any(Function), expect.any(Date), ['github.pull_request']);
    expect(handler).toHaveBeenCalledWith(event);
    expect(results.map((item) => item.ownerUserId)).toEqual(['owner-a', 'owner-b']);
  });

  it('does not query owner identities or inbox when no GitHub handler is registered', async () => {
    const listOwners = vi.fn();
    const processNextForOwner = vi.fn();
    const registry = new EventHandlerRegistry();
    registry.register('tapmap.connection.observed', vi.fn());
    await expect(dispatchNextGitHubEventForAuthorizedOwners(
      { processNextForOwner } as never, registry, listOwners, 'worker-a',
    )).resolves.toEqual([]);
    expect(listOwners).not.toHaveBeenCalled();
    expect(processNextForOwner).not.toHaveBeenCalled();
  });

  it('rejects event payloads that attempt to dispatch under another owner', async () => {
    const registry = new EventHandlerRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('github.pull_request', handler);
    const processNextForOwner = vi.fn(async (_worker, _owner, callback) => {
      await callback({ ...event, payload: { owner: { userId: 'owner-b' } } });
      return { status: 'processed' as const };
    });
    await expect(dispatchNextGitHubEventForAuthorizedOwners(
      { processNextForOwner } as never, registry, async () => ['owner-a'], 'worker-a',
    )).rejects.toThrow('authorized owner dispatch context');
    expect(handler).not.toHaveBeenCalled();
  });


  it('wakes owner-scoped dispatch only from the subscribed notification source', async () => {
    let notify: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const wakeSource = {
      subscribe: vi.fn((listener: () => void) => { notify = listener; return unsubscribe; }),
    };
    const processNextForOwner = vi.fn().mockResolvedValue({ status: 'idle' as const });
    const registry = new EventHandlerRegistry();
    registry.register('github.pull_request', vi.fn());
    const listOwners = vi.fn().mockResolvedValue(['owner-a']);
    const stop = startGitHubOwnerEventWorker(
      wakeSource,
      { processNextForOwner } as never,
      registry,
      listOwners,
      { workerId: 'wake-worker' },
    );
    expect(processNextForOwner).not.toHaveBeenCalled();
    notify?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(processNextForOwner).toHaveBeenCalledTimes(1);
    expect(processNextForOwner).toHaveBeenCalledWith(
      'wake-worker', 'owner-a', expect.any(Function), expect.any(Date), ['github.pull_request'],
    );
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    notify?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(processNextForOwner).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty worker identity before resolving owners', async () => {
    const listOwners = vi.fn();
    await expect(dispatchNextGitHubEventForAuthorizedOwners(
      {} as never, new EventHandlerRegistry(), listOwners, '  ',
    )).rejects.toThrow('workerId must contain');
    expect(listOwners).not.toHaveBeenCalled();
  });
});
