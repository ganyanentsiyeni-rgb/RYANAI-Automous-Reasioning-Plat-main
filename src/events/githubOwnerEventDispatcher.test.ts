import { describe, expect, it, vi } from 'vitest';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';
import { dispatchNextGitHubEventForAuthorizedOwners } from './githubOwnerEventDispatcher.js';
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
    const listOwners = vi.fn().mockResolvedValue(['owner-a', 'owner-a', ' owner-b ', '', null]);
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

  it('rejects an empty worker identity before resolving owners', async () => {
    const listOwners = vi.fn();
    await expect(dispatchNextGitHubEventForAuthorizedOwners(
      {} as never, new EventHandlerRegistry(), listOwners, '  ',
    )).rejects.toThrow('workerId must contain');
    expect(listOwners).not.toHaveBeenCalled();
  });
});
