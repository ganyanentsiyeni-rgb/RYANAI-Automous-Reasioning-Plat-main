import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  EventIdempotencyConflictError,
  EventLeaseLostError,
  EventAttemptAuditError,
  IntelligenceEventInbox,
} from './intelligenceEventInbox.js';

const validEvent = {
  eventId: '0b6b3c54-2d9a-4e25-8e14-8d4e4b1dfc01',
  eventType: 'tapmap.connection.observed',
  schemaVersion: 1,
  occurredAt: '2026-11-18T12:00:00.000Z',
  source: { provider: 'tapmap', service: 'desktop-agent' },
  correlationId: 'corr-123',
  idempotencyKey: 'tapmap:connection:123',
  classification: 'internal' as const,
  payload: { remoteIp: '203.0.113.8', port: 443 },
};

function makeDb() {
  const inboxDelegate = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };
  const attemptDelegate = { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const tx = { intelligenceEventInbox: inboxDelegate, intelligenceEventAttempt: attemptDelegate };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { db, inboxDelegate, attemptDelegate };
}

describe('IntelligenceEventInbox', () => {
  let db: PrismaClient;
  let inboxDelegate: ReturnType<typeof makeDb>['inboxDelegate'];
  let attemptDelegate: ReturnType<typeof makeDb>['attemptDelegate'];
  let inbox: IntelligenceEventInbox;

  beforeEach(() => {
    const mocks = makeDb();
    db = mocks.db;
    inboxDelegate = mocks.inboxDelegate;
    attemptDelegate = mocks.attemptDelegate;
    attemptDelegate.updateMany.mockResolvedValue({ count: 1 });
    inbox = new IntelligenceEventInbox(db, { baseRetryMs: 100, maxRetryMs: 1_000, leaseMs: 500 });
  });

  it('validates and persists a new provider event', async () => {
    inboxDelegate.create.mockResolvedValue({ id: 'row-1', eventId: validEvent.eventId });
    const result = await inbox.enqueue(validEvent);
    expect(result.duplicate).toBe(false);
    expect(inboxDelegate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventId: validEvent.eventId,
        sourceProvider: 'tapmap',
        idempotencyKey: validEvent.idempotencyKey,
        maxAttempts: 5,
      }),
    }));
  });

  it('rejects malformed envelopes before writing', async () => {
    await expect(inbox.enqueue({ ...validEvent, eventId: 'not-a-uuid' })).rejects.toThrow();
    expect(inboxDelegate.create).not.toHaveBeenCalled();
  });

  it('deduplicates identical deliveries and rejects changed content on key reuse', async () => {
    let existing: Record<string, unknown> = {};
    inboxDelegate.create
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
        existing = { ...data, id: 'row-1' };
        return existing;
      })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' });
    inboxDelegate.findFirst.mockImplementation(async () => existing);
    await inbox.enqueue(validEvent);
    const duplicate = await inbox.enqueue(validEvent);
    expect(duplicate.duplicate).toBe(true);
    await expect(inbox.enqueue({ ...validEvent, payload: { changed: true } }))
      .rejects.toBeInstanceOf(EventIdempotencyConflictError);
  });

  it('atomically claims due events and records the attempt', async () => {
    const candidate = { id: 'row-1', status: 'pending', attempts: 0, leaseExpiresAt: null };
    inboxDelegate.findFirst.mockResolvedValue(candidate);
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    inboxDelegate.findUnique.mockResolvedValue({ ...candidate, status: 'processing', attempts: 1, leaseOwner: 'worker-a' });
    const claimed = await inbox.claimNext('worker-a', new Date('2026-11-18T12:00:00Z'));
    expect(claimed).toMatchObject({ status: 'processing', leaseOwner: 'worker-a' });
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attempts: { increment: 1 }, leaseOwner: 'worker-a' }),
    }));
    expect(attemptDelegate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventInboxId: 'row-1', attempt: 1, status: 'started' }),
    }));
  });


  it('requires authenticated owner context before claiming GitHub events', async () => {
    await expect(inbox.claimNextForOwner('worker-a', '   ')).rejects.toThrow(
      'authenticatedOwnerUserId must contain 1-128 characters.',
    );
    expect(inboxDelegate.findFirst).not.toHaveBeenCalled();
  });

  it('filters GitHub claims by the authenticated owner in the database query', async () => {
    const now = new Date('2026-11-18T12:00:00Z');
    inboxDelegate.findFirst.mockResolvedValue(null);
    await inbox.claimNextForOwner('worker-a', 'owner-a', now, ['github.pull_request']);
    expect(inboxDelegate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceProvider: 'github',
        sourceService: 'event-streams',
        payload: { path: ['owner', 'userId'], equals: 'owner-a' },
        eventType: { in: ['github.pull_request'] },
      }),
    }));
  });

  it('prevents generic workers from claiming the owner-scoped GitHub lane', async () => {
    inboxDelegate.findFirst.mockResolvedValue(null);
    await inbox.claimNext('generic-worker', new Date('2026-11-18T12:00:00Z'));
    expect(inboxDelegate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: { sourceProvider: 'github', sourceService: 'event-streams' },
      }),
    }));
  });

  it('does not rewrite owner identity when an owner-scoped event is retried', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-owner', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
      payload: { owner: { userId: 'owner-a' }, githubEvent: { payload: { ownerUserId: 'owner-b' } } },
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    await inbox.fail('row-owner', 'worker-a', 1, new Error('temporary'), new Date('2026-11-18T12:00:00Z'));
    const update = inboxDelegate.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty('payload');
    expect(update.data.status).toBe('retry');
  });

  it('restricts worker claims to explicitly registered event types', async () => {
    const now = new Date('2026-11-18T12:00:00Z');
    inboxDelegate.findFirst.mockResolvedValue(null);
    await inbox.claimNext('worker-a', now, ['tapmap.connection.observed']);
    expect(inboxDelegate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventType: { in: ['tapmap.connection.observed'] },
      }),
    }));
    inboxDelegate.findFirst.mockClear();
    await expect(inbox.claimNext('worker-a', now, [])).resolves.toBeNull();
    expect(inboxDelegate.findFirst).not.toHaveBeenCalled();
  });

  it('renews a live worker lease only for its current owner', async () => {
    const now = new Date('2026-11-18T12:00:00Z');
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    await expect(inbox.renewLease('row-1', 'worker-a', 1, now)).resolves.toBe(true);
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'row-1', status: 'processing', leaseOwner: 'worker-a', attempts: 1,
        leaseExpiresAt: { gt: now },
      }),
      data: { leaseExpiresAt: new Date(now.getTime() + 500) },
    }));
  });

  it('fences a stale worker after a newer attempt has completed', async () => {
    const now = new Date('2026-11-18T12:00:00Z');
    // Worker B owns attempt 2 after reclaim and successfully acknowledges it.
    inboxDelegate.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-1', 'worker-b', 2, now)).resolves.toBeUndefined();
    expect(inboxDelegate.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 'row-1', leaseOwner: 'worker-b', attempts: 2 }),
    }));
    expect(attemptDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventInboxId: 'row-1', attempt: 2, workerId: 'worker-b', status: 'started' },
      data: expect.objectContaining({ status: 'succeeded' }),
    }));

    // Worker A returns late with attempt 1. None of its transitions may touch attempt 2.
    await expect(inbox.renewLease('row-1', 'worker-a', 1, now)).resolves.toBe(false);
    await expect(inbox.acknowledge('row-1', 'worker-a', 1, now)).rejects.toBeInstanceOf(EventLeaseLostError);
    inboxDelegate.findFirst.mockResolvedValue(null);
    await expect(inbox.fail('row-1', 'worker-a', 1, new Error('late failure'), now))
      .rejects.toBeInstanceOf(EventLeaseLostError);
    expect(inboxDelegate.updateMany).toHaveBeenCalledTimes(3);
    expect(attemptDelegate.updateMany).toHaveBeenCalledTimes(1);
  });



  it('fences a reclaimed attempt when the same worker id is reused', async () => {
    const now = new Date('2026-11-18T12:00:00Z');
    inboxDelegate.findMany.mockResolvedValue([{
      id: 'row-same-worker', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-reused',
      leaseExpiresAt: new Date('2026-11-18T11:59:00Z'),
    }]);
    inboxDelegate.updateMany
      .mockResolvedValueOnce({ count: 1 }) // recovery
      .mockResolvedValueOnce({ count: 1 }) // reclaim attempt 2 with same worker
      .mockResolvedValueOnce({ count: 0 }); // stale attempt 1 must be fenced
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-same-worker', status: 'retry', attempts: 1, maxAttempts: 5,
      leaseOwner: null, leaseExpiresAt: null,
    });
    inboxDelegate.findUnique.mockResolvedValue({
      id: 'row-same-worker', status: 'processing', attempts: 2, leaseOwner: 'worker-reused',
    });
    attemptDelegate.create.mockResolvedValue({});
    await expect(inbox.recoverExpiredLeases(now)).resolves.toBe(1);
    const reclaimed = await inbox.claimNext('worker-reused', new Date(now.getTime() + 1));
    expect(reclaimed).toMatchObject({ attempts: 2, leaseOwner: 'worker-reused' });
    await expect(inbox.acknowledge('row-same-worker', 'worker-reused', 1, new Date(now.getTime() + 2)))
      .rejects.toBeInstanceOf(EventLeaseLostError);
    expect(attemptDelegate.updateMany).toHaveBeenCalledTimes(1);
    expect(attemptDelegate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventInboxId: 'row-same-worker', attempt: 2, workerId: 'worker-reused' }),
    }));
  });

  it('does not recover or close an attempt after its lease was renewed or reclaimed', async () => {
    inboxDelegate.findMany.mockResolvedValue([{
      id: 'row-1', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-11-18T11:59:00Z'),
    }]);
    inboxDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.recoverExpiredLeases(new Date('2026-11-18T12:00:00Z'))).resolves.toBe(0);
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'row-1', status: 'processing', attempts: 1, leaseOwner: 'worker-a',
        leaseExpiresAt: new Date('2026-11-18T11:59:00Z'),
      }),
    }));
    expect(attemptDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('acknowledges only a live lease owned by the worker', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-1', 'wrong-worker', 1)).rejects.toBeInstanceOf(EventLeaseLostError);
    expect(attemptDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('backs off failures and records retry audit evidence', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-1', attempts: 2, maxAttempts: 5, leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const result = await inbox.fail('row-1', 'worker-a', 2, new Error('temporary failure'), new Date('2026-11-18T12:00:00Z'));
    expect(result.status).toBe('retry');
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry', lastError: 'temporary failure' }),
    }));
    expect(attemptDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry', error: 'temporary failure' }),
    }));
  });

  it('dead-letters events after the maximum attempt count', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-1', attempts: 5, maxAttempts: 5, leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const result = await inbox.fail('row-1', 'worker-a', 5, 'permanent failure', new Date('2026-11-18T12:00:00Z'));
    expect(result.status).toBe('dead_letter');
    expect(attemptDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'dead_letter' }),
    }));
  });

  it('recovers expired leases and closes their attempt records', async () => {
    inboxDelegate.findMany.mockResolvedValue([
      { id: 'row-1', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a', leaseExpiresAt: new Date('2026-11-18T11:59:00Z') },
      { id: 'row-2', attempts: 5, maxAttempts: 5, leaseOwner: 'worker-b', leaseExpiresAt: new Date('2026-11-18T11:58:00Z') },
    ]);
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const recovered = await inbox.recoverExpiredLeases(new Date('2026-11-18T12:00:00Z'));
    expect(recovered).toBe(2);
    expect(inboxDelegate.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'dead_letter' }),
    }));
    expect(attemptDelegate.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects acknowledgement when its started audit row is missing', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    attemptDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-1', 'worker-a', 1))
      .rejects.toThrow('Expected exactly one started attempt audit record to transition; updated 0.');
  });

  it('rejects failure when its started audit row is missing', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-1', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    attemptDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.fail('row-1', 'worker-a', 1, new Error('synthetic')))
      .rejects.toThrow('Expected exactly one started attempt audit record to transition; updated 0.');
  });

  it('rejects expiry recovery when its started audit row is missing', async () => {
    inboxDelegate.findMany.mockResolvedValue([{
      id: 'row-1', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date(Date.now() - 60_000),
    }]);
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    attemptDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.recoverExpiredLeases())
      .rejects.toThrow('Expected exactly one started attempt audit record to transition; updated 0.');
  });

  it('requeues dead letters without changing event identity', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    await expect(inbox.requeueDeadLetter('row-1')).resolves.toBe(true);
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row-1', status: 'dead_letter' },
      data: expect.objectContaining({ status: 'pending', attempts: 0 }),
    }));
  });


  it('rolls back an inbox transition when its attempt audit row is missing', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    attemptDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-missing-audit', 'worker-a', 1))
      .rejects.toBeInstanceOf(EventAttemptAuditError);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('rejects duplicate attempt-audit transitions during failure and recovery', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-missing-fail-audit', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    attemptDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.fail('row-missing-fail-audit', 'worker-a', 1, new Error('failure')))
      .rejects.toBeInstanceOf(EventAttemptAuditError);

    inboxDelegate.findMany.mockResolvedValue([{
      id: 'row-missing-recovery-audit', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-11-18T11:59:00Z'),
    }]);
    await expect(inbox.recoverExpiredLeases(new Date('2026-11-18T12:00:00Z')))
      .rejects.toBeInstanceOf(EventAttemptAuditError);
  });

  it('returns all queue status counts', async () => {
    inboxDelegate.count.mockResolvedValue(2);
    await expect(inbox.statusCounts()).resolves.toEqual({
      pending: 2, processing: 2, retry: 2, processed: 2, dead_letter: 2,
    });
  });

  it('runs one claimed event through a trusted handler', async () => {
    const candidate = {
      id: 'row-1', eventId: validEvent.eventId, eventType: validEvent.eventType,
      schemaVersion: 1, occurredAt: new Date(validEvent.occurredAt),
      sourceProvider: 'tapmap', sourceService: 'desktop-agent', correlationId: 'corr-123',
      idempotencyKey: validEvent.idempotencyKey, classification: 'internal',
      payload: validEvent.payload, status: 'pending', attempts: 0, leaseExpiresAt: null,
    };
    inboxDelegate.findFirst.mockResolvedValue(candidate);
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    inboxDelegate.findUnique.mockResolvedValue({ ...candidate, attempts: 1, status: 'processing', leaseOwner: 'worker-a' });
    attemptDelegate.create.mockResolvedValue({});
    const handler = vi.fn().mockResolvedValue(undefined);
    const result = await inbox.processNext('worker-a', handler);
    expect(result).toMatchObject({ status: 'processed', eventId: validEvent.eventId });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      eventId: validEvent.eventId, source: { provider: 'tapmap', service: 'desktop-agent' },
    }));
  });

  it('routes trusted handler failures through the retry path without acknowledging', async () => {
    const candidate = {
      id: 'row-failure', eventId: validEvent.eventId, eventType: validEvent.eventType,
      schemaVersion: 1, occurredAt: new Date(validEvent.occurredAt),
      sourceProvider: 'tapmap', sourceService: 'desktop-agent', correlationId: 'corr-123',
      idempotencyKey: validEvent.idempotencyKey, classification: 'internal',
      payload: validEvent.payload, status: 'pending', attempts: 0, leaseExpiresAt: null,
    };
    inboxDelegate.findFirst
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce({
        id: 'row-failure', attempts: 1, maxAttempts: 5, leaseOwner: 'worker-a',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    inboxDelegate.findUnique.mockResolvedValue({ ...candidate, attempts: 1, status: 'processing', leaseOwner: 'worker-a' });
    attemptDelegate.create.mockResolvedValue({});
    const handler = vi.fn().mockRejectedValue(new Error('handler rejected untrusted payload'));
    const result = await inbox.processNext('worker-a', handler);
    expect(result).toMatchObject({ status: 'retry', eventId: validEvent.eventId });
    expect(inboxDelegate.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry', lastError: 'handler rejected untrusted payload' }),
    }));
    expect(attemptDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry', error: 'handler rejected untrusted payload' }),
    }));
  });

});
