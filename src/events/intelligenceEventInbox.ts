import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  RyanAIEventEnvelopeSchema,
  type RyanAIEventEnvelope,
} from './eventContract.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_BASE_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 15 * 60_000;

export type IntelligenceEventStatus = 'pending' | 'processing' | 'retry' | 'processed' | 'dead_letter';
export type IntelligenceEventAttemptStatus = 'started' | 'succeeded' | 'retry' | 'dead_letter' | 'lease_expired';

export class EventIdempotencyConflictError extends Error {
  constructor(message = 'The event identity or idempotency key was reused with different content.') {
    super(message);
    this.name = 'EventIdempotencyConflictError';
  }
}

export class EventLeaseLostError extends Error {
  constructor(message = 'The event lease is missing, expired, or owned by another worker.') {
    super(message);
    this.name = 'EventLeaseLostError';
  }
}

export interface EventInboxOptions {
  maxAttempts?: number;
  leaseMs?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
}

export interface EnqueueEventResult {
  event: Prisma.IntelligenceEventInboxGetPayload<true>;
  duplicate: boolean;
}

export type EventHandler = (event: RyanAIEventEnvelope) => Promise<void>;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(event: RyanAIEventEnvelope): string {
  return createHash('sha256').update(canonicalize(event)).digest('hex');
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function toEnvelope(row: Prisma.IntelligenceEventInboxGetPayload<true>): RyanAIEventEnvelope {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.toISOString(),
    source: {
      provider: row.sourceProvider,
      ...(row.sourceService ? { service: row.sourceService } : {}),
    },
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    idempotencyKey: row.idempotencyKey,
    classification: row.classification as RyanAIEventEnvelope['classification'],
    payload: row.payload as unknown as Record<string, unknown>,
  };
}

/**
 * Durable provider-neutral inbox. It validates and stores data only; a handler
 * supplied by trusted server code owns interpretation and execution. Payloads
 * remain untrusted and this class never authorizes outbound actions.
 */
export class IntelligenceEventInbox {
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;

  constructor(private readonly db: PrismaClient, options: EventInboxOptions = {}) {
    this.maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
    this.leaseMs = positiveInteger(options.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs');
    this.baseRetryMs = positiveInteger(options.baseRetryMs ?? DEFAULT_BASE_RETRY_MS, 'baseRetryMs');
    this.maxRetryMs = positiveInteger(options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS, 'maxRetryMs');
    if (this.maxRetryMs < this.baseRetryMs) throw new RangeError('maxRetryMs must be >= baseRetryMs.');
  }

  async enqueue(rawEvent: unknown): Promise<EnqueueEventResult> {
    const event = RyanAIEventEnvelopeSchema.parse(rawEvent);
    const payloadHash = fingerprint(event);
    try {
      const stored = await this.db.intelligenceEventInbox.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          schemaVersion: event.schemaVersion,
          occurredAt: new Date(event.occurredAt),
          sourceProvider: event.source.provider,
          sourceService: event.source.service ?? null,
          correlationId: event.correlationId ?? null,
          idempotencyKey: event.idempotencyKey,
          classification: event.classification,
          payload: event.payload as Prisma.InputJsonObject,
          payloadHash,
          maxAttempts: this.maxAttempts,
        },
      });
      return { event: stored, duplicate: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.db.intelligenceEventInbox.findFirst({
        where: {
          OR: [
            { eventId: event.eventId },
            { sourceProvider: event.source.provider, idempotencyKey: event.idempotencyKey },
          ],
        },
      });
      if (!existing) throw error;
      if (existing.eventId !== event.eventId || existing.payloadHash !== payloadHash) {
        throw new EventIdempotencyConflictError();
      }
      return { event: existing, duplicate: true };
    }
  }

  /**
   * Generic workers are deliberately excluded from the GitHub Event Streams
   * lane. GitHub events may only be claimed through claimNextForOwner().
   */
  async claimNext(workerId: string, now = new Date(), eventTypes?: string[]) {
    return this.claimNextInternal(workerId, now, eventTypes, null);
  }

  /**
   * Claim a GitHub event only for the authenticated RyanAI owner supplied by
   * trusted server context. The JSON owner filter is applied in the database
   * query, before a lease can be acquired; event payload fields never select
   * or override this identity.
   */
  async claimNextForOwner(
    workerId: string,
    authenticatedOwnerUserId: string,
    now = new Date(),
    eventTypes?: string[],
  ) {
    const ownerUserId = authenticatedOwnerUserId.trim();
    if (!ownerUserId || ownerUserId.length > 128) {
      throw new RangeError('authenticatedOwnerUserId must contain 1-128 characters.');
    }
    return this.claimNextInternal(workerId, now, eventTypes, ownerUserId);
  }

  private async claimNextInternal(
    workerId: string,
    now: Date,
    eventTypes: string[] | undefined,
    authenticatedOwnerUserId: string | null,
  ) {
    const worker = workerId.trim();
    if (!worker || worker.length > 128) throw new RangeError('workerId must contain 1-128 characters.');
    const allowedTypes = eventTypes?.filter((value) => typeof value === 'string' && value.length > 0);
    if (eventTypes && (!allowedTypes || allowedTypes.length === 0)) return null;

    const githubLane = { sourceProvider: 'github', sourceService: 'event-streams' };
    const ownerScope = authenticatedOwnerUserId
      ? {
          ...githubLane,
          payload: { path: ['owner', 'userId'], equals: authenticatedOwnerUserId },
        }
      : { NOT: githubLane };

    return this.db.$transaction(async (tx) => {
      const candidate = await tx.intelligenceEventInbox.findFirst({
        where: {
          ...ownerScope,
          ...(allowedTypes ? { eventType: { in: allowedTypes } } : {}),
          OR: [
            { status: 'pending', availableAt: { lte: now } },
            { status: 'retry', availableAt: { lte: now } },
            { status: 'processing', leaseExpiresAt: { lte: now } },
            { status: 'processing', leaseExpiresAt: null },
          ],
        },
        orderBy: [{ availableAt: 'asc' }, { receivedAt: 'asc' }],
      });
      if (!candidate) return null;
      const leaseCondition = candidate.status === 'processing'
        ? { leaseExpiresAt: candidate.leaseExpiresAt }
        : { availableAt: { lte: now } };
      const claimed = await tx.intelligenceEventInbox.updateMany({
        where: { ...ownerScope, id: candidate.id, status: candidate.status, ...leaseCondition },
        where: { ...ownerScope, id: candidate.id, status: candidate.status, attempts: candidate.attempts, ...leaseCondition },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          leaseOwner: worker,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          lastError: null,
        },
      });
      if (claimed.count !== 1) return null;
      await tx.intelligenceEventAttempt.create({
        data: { eventInboxId: candidate.id, attempt: candidate.attempts + 1, workerId: worker, status: 'started' },
      });
      return tx.intelligenceEventInbox.findUnique({ where: { id: candidate.id } });
    });
  }

  async renewLease(eventId: string, workerId: string, attempt: number, now = new Date()): Promise<boolean> {
    positiveInteger(attempt, 'attempt');
    const result = await this.db.intelligenceEventInbox.updateMany({
      where: { id: eventId, status: 'processing', leaseOwner: workerId, attempts: attempt, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + this.leaseMs) },
    });
    return result.count === 1;
  }

  async acknowledge(eventId: string, workerId: string, attempt: number, now = new Date()): Promise<void> {
    positiveInteger(attempt, 'attempt');
    await this.db.$transaction(async (tx) => {
      const result = await tx.intelligenceEventInbox.updateMany({
        where: { id: eventId, status: 'processing', leaseOwner: workerId, attempts: attempt, leaseExpiresAt: { gt: now } },
        data: { status: 'processed', processedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: null },
      });
      if (result.count !== 1) throw new EventLeaseLostError();
      await tx.intelligenceEventAttempt.updateMany({
        where: { eventInboxId: eventId, attempt, workerId, status: 'started' },
        data: { status: 'succeeded', finishedAt: now },
      });
    });
  }

  async fail(eventId: string, workerId: string, attempt: number, error: unknown, now = new Date()) {
    positiveInteger(attempt, 'attempt');
    return this.db.$transaction(async (tx) => {
      const current = await tx.intelligenceEventInbox.findFirst({
        where: { id: eventId, status: 'processing', leaseOwner: workerId, attempts: attempt, leaseExpiresAt: { gt: now } },
      });
      if (!current) throw new EventLeaseLostError();
      const deadLetter = current.attempts >= current.maxAttempts;
      const delay = Math.min(this.baseRetryMs * (2 ** Math.max(0, current.attempts - 1)), this.maxRetryMs);
      const retryAt = deadLetter ? null : new Date(now.getTime() + delay);
      const result = await tx.intelligenceEventInbox.updateMany({
        where: { id: current.id, status: 'processing', leaseOwner: workerId, attempts: attempt, leaseExpiresAt: { equals: current.leaseExpiresAt, gt: now } },
        data: {
          status: deadLetter ? 'dead_letter' : 'retry',
          ...(retryAt ? { availableAt: retryAt } : {}),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: errorMessage(error),
        },
      });
      if (result.count !== 1) throw new EventLeaseLostError();
      await tx.intelligenceEventAttempt.updateMany({
        where: { eventInboxId: eventId, attempt, workerId, status: 'started' },
        data: { status: deadLetter ? 'dead_letter' : 'retry', error: errorMessage(error), finishedAt: now },
      });
      return { status: deadLetter ? 'dead_letter' as const : 'retry' as const, retryAt };
    });
  }

  /** Moves abandoned leases to retry or dead-letter and closes their attempt record. */
  async recoverExpiredLeases(now = new Date()): Promise<number> {
    const expired = await this.db.intelligenceEventInbox.findMany({
      where: { status: 'processing', OR: [{ leaseExpiresAt: { lte: now } }, { leaseExpiresAt: null }] },
      orderBy: { leaseExpiresAt: 'asc' },
      take: 500,
    });
    let recovered = 0;
    for (const event of expired) {
      const deadLetter = event.attempts >= event.maxAttempts;
      const result = await this.db.$transaction(async (tx) => {
        const moved = await tx.intelligenceEventInbox.updateMany({
          where: { id: event.id, status: 'processing', attempts: event.attempts, leaseOwner: event.leaseOwner, leaseExpiresAt: event.leaseExpiresAt },
          data: {
            status: deadLetter ? 'dead_letter' : 'retry',
            availableAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: 'Worker lease expired before acknowledgement.',
          },
        });
        if (moved.count === 1) {
          await tx.intelligenceEventAttempt.updateMany({
            where: { eventInboxId: event.id, attempt: event.attempts, workerId: event.leaseOwner ?? undefined, status: 'started' },
            data: { status: 'lease_expired', error: 'Worker lease expired before acknowledgement.', finishedAt: now },
          });
        }
        return moved.count;
      });
      recovered += result;
    }
    return recovered;
  }

  async requeueDeadLetter(eventId: string, now = new Date()): Promise<boolean> {
    const result = await this.db.intelligenceEventInbox.updateMany({
      where: { id: eventId, status: 'dead_letter' },
      data: {
        status: 'pending', attempts: 0, maxAttempts: this.maxAttempts, availableAt: now,
        leaseOwner: null, leaseExpiresAt: null, processedAt: null, lastError: null,
      },
    });
    return result.count === 1;
  }

  async listDeadLetters(limit = 50) {
    positiveInteger(limit, 'limit');
    if (limit > 100) throw new RangeError('limit cannot exceed 100.');
    return this.db.intelligenceEventInbox.findMany({
      where: { status: 'dead_letter' }, orderBy: { receivedAt: 'desc' }, take: limit,
    });
  }

  async statusCounts(): Promise<Record<IntelligenceEventStatus, number>> {
    const statuses: IntelligenceEventStatus[] = ['pending', 'processing', 'retry', 'processed', 'dead_letter'];
    const counts = await Promise.all(statuses.map(async (status) => [
      status, await this.db.intelligenceEventInbox.count({ where: { status } }),
    ] as const));
    return Object.fromEntries(counts) as Record<IntelligenceEventStatus, number>;
  }

  /** Owner-scoped GitHub processing; owner identity comes from authenticated server context. */
  async processNextForOwner(
    workerId: string,
    authenticatedOwnerUserId: string,
    handler: EventHandler,
    now = new Date(),
    eventTypes?: string[],
  ) {
    const claimed = await this.claimNextForOwner(workerId, authenticatedOwnerUserId, now, eventTypes);
    if (!claimed) return { status: 'idle' as const };
    const payload = claimed.payload as Record<string, unknown>;
    const owner = payload.owner as Record<string, unknown> | undefined;
    if (!owner || owner.userId !== authenticatedOwnerUserId) {
      const outcome = await this.fail(
        claimed.id,
        workerId,
        claimed.attempts,
        new Error('Claimed GitHub event owner does not match authenticated worker context.'),
        new Date(),
      );
      return { ...outcome, eventId: claimed.eventId };
    }
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.renewLease(claimed.id, workerId)
      void this.renewLease(claimed.id, workerId, claimed.attempts)
        .then((renewed) => { if (!renewed) leaseLost = true; })
        .catch(() => { leaseLost = true; });
    }, Math.max(50, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    try {
      await handler(toEnvelope(claimed));
      if (leaseLost) throw new EventLeaseLostError();
      await this.acknowledge(claimed.id, workerId, new Date());
      return { status: 'processed' as const, eventId: claimed.eventId };
    } catch (error) {
      if (leaseLost) throw new EventLeaseLostError();
      const outcome = await this.fail(claimed.id, workerId, error, new Date());
      await this.acknowledge(claimed.id, workerId, claimed.attempts, new Date());
      return { status: 'processed' as const, eventId: claimed.eventId };
    } catch (error) {
      if (leaseLost) throw new EventLeaseLostError();
      const outcome = await this.fail(claimed.id, workerId, claimed.attempts, error, new Date());
      return { ...outcome, eventId: claimed.eventId };
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Runs one event through a trusted handler. Handler failures are retried or dead-lettered. */
  async processNext(workerId: string, handler: EventHandler, now = new Date(), eventTypes?: string[]) {
    const claimed = await this.claimNext(workerId, now, eventTypes);
    if (!claimed) return { status: 'idle' as const };
    // Keep long-running handlers from losing their lease while work is in flight.
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.renewLease(claimed.id, workerId, claimed.attempts)
        .then((renewed) => { if (!renewed) leaseLost = true; })
        .catch(() => { leaseLost = true; });
    }, Math.max(50, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();

    try {
      await handler(toEnvelope(claimed));
      if (leaseLost) throw new EventLeaseLostError();
      await this.acknowledge(claimed.id, workerId, claimed.attempts, new Date());
      return { status: 'processed' as const, eventId: claimed.eventId };
    } catch (error) {
      if (leaseLost) throw new EventLeaseLostError();
      const outcome = await this.fail(claimed.id, workerId, claimed.attempts, error, new Date());
      return { ...outcome, eventId: claimed.eventId };
    } finally {
      clearInterval(heartbeat);
    }
  }
}
