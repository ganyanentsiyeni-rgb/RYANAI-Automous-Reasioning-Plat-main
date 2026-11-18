import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  EventIdempotencyConflictError,
  EventLeaseLostError,
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
  const delegate = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };
  const db = {
    intelligenceEventInbox: delegate,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ intelligenceEventInbox: delegate })),
  } as unknown as PrismaClient;
  return { db, delegate };
}

describe('IntelligenceEventInbox', () => {
  let db: PrismaClient;
  let delegate: ReturnType<typeof makeDb>['delegate'];
  let inbox: IntelligenceEventInbox;

  beforeEach(() => {
    const mocks = makeDb();
    db = mocks.db;
    delegate = mocks.delegate;
    inbox = new IntelligenceEventInbox(db, { baseRetryMs: 100, maxRetryMs: 1_000, leaseMs: 500 });
  });

  it('validates and persists a new provider event', async () => {
    delegate.create.mockResolvedValue({ id: 'row-1', eventId: validEvent.eventId });
    const result = await inbox.enqueue(validEvent);
    expect(result.duplicate).toBe(false);
    expect(delegate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventId: validEvent.eventId,
        sourceProvider: 'tapmap',
        status: undefined,
      }),
    }));
  });

  it('rejects malformed event envelopes before writing', async () => {
    await expect(inbox.enqueue({ ...validEvent, eventId: 'not-a-uuid' })).rejects.toThrow();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('returns a matching duplicate and rejects key reuse with changed content', async () => {
    const existing = { id: 'row-1', eventId: validEvent.eventId, payloadHash: 'not-the-current-hash' };
    delegate.create.mockRejectedValue({ code: 'P2002' });
    delegate.findFirst.mockResolvedValue(existing);
    await expect(inbox.enqueue(validEvent)).rejects.toBeInstanceOf(EventIdempotencyConflictError);
  });

  it('atomically claims due events and increments the attempt count', async () => {
    const candidate = { id: 'row-1', status: 'pending', leaseExpiresAt: null };
    delegate.findFirst.mockResolvedValue(candidate);
    delegate.updateMany.mockResolvedValue({ count: 1 });
    delegate.findUnique.mockResolvedValue({ ...candidate, status: 'processing', leaseOwner: 'worker-a' });
    const claimed = await inbox.claimNext('worker-a', new Date('2026-11-18T12:00:00Z'));
    expect(claimed).toMatchObject({ status: 'processing', leaseOwner: 'worker-a' });
    expect(delegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attempts: { increment: 1 }, leaseOwner: 'worker-a' }),
    }));
  });

  it('acknowledges only a live lease owned by the worker', async () => {
    delegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-1', 'wrong-worker')).rejects.toBeInstanceOf(EventLeaseLostError);
  });

  it('backs off failures and dead-letters events after the configured attempt limit', async () => {
    delegate.findFirst.mockResolvedValue({
      id: 'row-1', attempts: 2, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    delegate.updateMany.mockResolvedValue({ count: 1 });
    const result = await inbox.fail('row-1', 'worker-a', new Error('temporary failure'), new Date('2026-11-18T12:00:00Z'));
    expect(result.status).toBe('retry');
    expect(delegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry', lastError: 'temporary failure' }),
    }));
  });

  it('recovers expired leases and respects max attempts', async () => {
    delegate.findMany.mockResolvedValue([
      { id: 'row-1', attempts: 1, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T11:59:00Z') },
      { id: 'row-2', attempts: 5, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T11:58:00Z') },
    ]);
    delegate.updateMany.mockResolvedValue({ count: 1 });
    const recovered = await inbox.recoverExpiredLeases(new Date('2026-11-18T12:00:00Z'));
    expect(recovered).toBe(2);
    expect(delegate.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'dead_letter' }),
    }));
  });

  it('requeues dead letters without changing their event identity', async () => {
    delegate.updateMany.mockResolvedValue({ count: 1 });
    await expect(inbox.requeueDeadLetter('row-1')).resolves.toBe(true);
    expect(delegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row-1', status: 'dead_letter' },
      data: expect.objectContaining({ status: 'pending', attempts: 0 }),
    }));
  });

  it('returns all queue status counts', async () => {
    delegate.count.mockResolvedValue(2);
    await expect(inbox.statusCounts()).resolves.toEqual({
      pending: 2, processing: 2, retry: 2, processed: 2, dead_letter: 2,
    });
  });
});
