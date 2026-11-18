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
  const inboxDelegate = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };
  const attemptDelegate = { create: vi.fn(), updateMany: vi.fn() };
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
    inboxDelegate.findUnique.mockResolvedValue({ ...candidate, status: 'processing', leaseOwner: 'worker-a' });
    const claimed = await inbox.claimNext('worker-a', new Date('2026-11-18T12:00:00Z'));
    expect(claimed).toMatchObject({ status: 'processing', leaseOwner: 'worker-a' });
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attempts: { increment: 1 }, leaseOwner: 'worker-a' }),
    }));
    expect(attemptDelegate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventInboxId: 'row-1', attempt: 1, status: 'started' }),
    }));
  });

  it('acknowledges only a live lease owned by the worker', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 0 });
    await expect(inbox.acknowledge('row-1', 'wrong-worker')).rejects.toBeInstanceOf(EventLeaseLostError);
    expect(attemptDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('backs off failures and records retry audit evidence', async () => {
    inboxDelegate.findFirst.mockResolvedValue({
      id: 'row-1', attempts: 2, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const result = await inbox.fail('row-1', 'worker-a', new Error('temporary failure'), new Date('2026-11-18T12:00:00Z'));
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
      id: 'row-1', attempts: 5, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T12:01:00Z'),
    });
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const result = await inbox.fail('row-1', 'worker-a', 'permanent failure', new Date('2026-11-18T12:00:00Z'));
    expect(result.status).toBe('dead_letter');
    expect(attemptDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'dead_letter' }),
    }));
  });

  it('recovers expired leases and closes their attempt records', async () => {
    inboxDelegate.findMany.mockResolvedValue([
      { id: 'row-1', attempts: 1, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T11:59:00Z') },
      { id: 'row-2', attempts: 5, maxAttempts: 5, leaseExpiresAt: new Date('2026-11-18T11:58:00Z') },
    ]);
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    const recovered = await inbox.recoverExpiredLeases(new Date('2026-11-18T12:00:00Z'));
    expect(recovered).toBe(2);
    expect(inboxDelegate.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: 'dead_letter' }),
    }));
    expect(attemptDelegate.updateMany).toHaveBeenCalledTimes(2);
  });

  it('requeues dead letters without changing event identity', async () => {
    inboxDelegate.updateMany.mockResolvedValue({ count: 1 });
    await expect(inbox.requeueDeadLetter('row-1')).resolves.toBe(true);
    expect(inboxDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'row-1', status: 'dead_letter' },
      data: expect.objectContaining({ status: 'pending', attempts: 0 }),
    }));
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
    inboxDelegate.findUnique.mockResolvedValue({ ...candidate, status: 'processing', leaseOwner: 'worker-a' });
    attemptDelegate.create.mockResolvedValue({});
    const handler = vi.fn().mockResolvedValue(undefined);
    const result = await inbox.processNext('worker-a', handler, new Date('2026-11-18T12:00:00Z'));
    expect(result).toMatchObject({ status: 'processed', eventId: validEvent.eventId });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      eventId: validEvent.eventId, source: { provider: 'tapmap', service: 'desktop-agent' },
    }));
  });
});
