import { describe, expect, it, vi } from 'vitest';
import { enqueueRyanAiGitHubOwnerBoundEvent } from './githubOwnerBoundEvent.js';

const connection = {
  userId: 'owner-1',
  githubUserId: 'github-22',
  repositoryId: '987654',
  repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
};

const event = {
  id: 'delivery-abc-123',
  type: 'pull_request' as const,
  repository: connection.repositoryFullName,
  occurredAt: '2026-11-19T12:30:00.000Z',
  payload: {
    action: 'synchronize',
    repository: { id: 987654, full_name: connection.repositoryFullName },
    ownerUserId: 'spoofed-owner',
  },
};

describe('owner-bound GitHub inbox adapter', () => {
  it('resolves the authenticated owner and enqueues a trusted envelope', async () => {
    const enqueue = vi.fn().mockResolvedValue({ event: { id: 'row-1' }, duplicate: false });
    const lookup = vi.fn().mockResolvedValue(connection);

    const result = await enqueueRyanAiGitHubOwnerBoundEvent(
      { enqueue } as never,
      'owner-1',
      lookup,
      event,
    );

    expect(lookup).toHaveBeenCalledWith('owner-1');
    expect(result).toMatchObject({ duplicate: false });
    const envelope = enqueue.mock.calls[0][0];
    expect(envelope).toMatchObject({
      eventType: 'github.pull_request',
      source: { provider: 'github', service: 'event-streams' },
      classification: 'confidential',
      payload: {
        owner: {
          userId: 'owner-1',
          githubUserId: 'github-22',
          repositoryId: '987654',
          repositoryFullName: connection.repositoryFullName,
        },
        githubEvent: { id: event.id, type: 'pull_request' },
      },
    });
    expect(envelope.payload.owner.userId).not.toBe(event.payload.ownerUserId);
    expect(envelope.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not enqueue when the authenticated owner has no GitHub connection', async () => {
    const enqueue = vi.fn();
    const result = await enqueueRyanAiGitHubOwnerBoundEvent(
      { enqueue } as never,
      'owner-1',
      async () => null,
      event,
    );
    expect(result).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a provider event for a different repository before enqueue', async () => {
    const enqueue = vi.fn();
    await expect(enqueueRyanAiGitHubOwnerBoundEvent(
      { enqueue } as never,
      'owner-1',
      async () => connection,
      {
        ...event,
        repository: 'attacker/fork',
        payload: { repository: { id: 999, full_name: 'attacker/fork' } },
      },
    )).rejects.toThrow(/does not match/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects invalid event timestamps before enqueue', async () => {
    const enqueue = vi.fn();
    await expect(enqueueRyanAiGitHubOwnerBoundEvent(
      { enqueue } as never,
      'owner-1',
      async () => connection,
      { ...event, occurredAt: 'not-a-date' },
    )).rejects.toThrow(/timestamp is invalid/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('uses a deterministic event identity for duplicate provider deliveries', async () => {
    const enqueue = vi.fn().mockResolvedValue({ event: {}, duplicate: true });
    const args = [{ enqueue } as never, 'owner-1', async () => connection, event] as const;
    await enqueueRyanAiGitHubOwnerBoundEvent(...args);
    await enqueueRyanAiGitHubOwnerBoundEvent(...args);
    expect(enqueue.mock.calls[0][0].eventId).toBe(enqueue.mock.calls[1][0].eventId);
    expect(enqueue.mock.calls[0][0].idempotencyKey).toBe(enqueue.mock.calls[1][0].idempotencyKey);
  });
});
