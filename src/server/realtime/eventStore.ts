import { Prisma, PrismaClient } from '@prisma/client';

export type RealtimeAudience = {
  /** Server-derived audience class; never accept this value from a browser. */
  type: 'user' | 'workspace' | 'system';
  /** Stable server-verified identifier for the audience. */
  id: string;
};

export type AppendRealtimeEventInput = {
  audience: RealtimeAudience;
  channel: string;
  eventType: string;
  payload: Record<string, unknown>;
  retentionMs?: number;
};

export type ReplayRealtimeEventsInput = {
  audience: RealtimeAudience;
  channel: string;
  afterSequence: bigint | number;
  limit?: number;
};

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPLAY_PAGE_SIZE = 100;

function validateScope(audience: RealtimeAudience, channel: string): void {
  if (!audience.id.trim() || audience.id.length > 160) {
    throw new Error('Invalid realtime audience identifier');
  }
  if (!/^[a-z][a-z0-9._:-]{0,119}$/.test(channel)) {
    throw new Error('Invalid realtime channel');
  }
}

function normalizeCursor(cursor: bigint | number): bigint {
  if (typeof cursor === 'number') {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error('Replay cursor must be a non-negative safe integer');
    }
    return BigInt(cursor);
  }
  if (cursor < 0n) throw new Error('Replay cursor must be non-negative');
  return cursor;
}

/**
 * Persist an event and allocate its sequence in the same PostgreSQL transaction.
 * Callers may broadcast the returned event only after this function resolves.
 * The audience must be derived from authenticated server-side context.
 */
export async function appendRealtimeEvent(
  prisma: PrismaClient,
  input: AppendRealtimeEventInput,
) {
  validateScope(input.audience, input.channel);
  if (!/^[a-z][a-z0-9._-]{0,159}$/.test(input.eventType)) {
    throw new Error('Invalid realtime event type');
  }
  const retentionMs = input.retentionMs ?? DEFAULT_RETENTION_MS;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > MAX_RETENTION_MS) {
    throw new Error('Realtime event retention must be between 1ms and 30 days');
  }

  return prisma.$transaction(async (tx) => {
    const scope = {
      audienceType: input.audience.type,
      audienceId: input.audience.id,
      channel: input.channel,
    };
    const counter = await tx.realtimeChannelSequence.upsert({
      where: { audienceType_audienceId_channel: scope },
      create: { ...scope, nextSequence: 1n },
      update: { nextSequence: { increment: 1n } },
      select: { nextSequence: true },
    });

    return tx.realtimeEvent.create({
      data: {
        ...scope,
        sequence: counter.nextSequence,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + retentionMs),
      },
    });
  });
}

/**
 * Replay only events belonging to the exact trusted audience/channel scope.
 * Expired history is explicit: callers must trigger a state resynchronization.
 */
export async function replayRealtimeEvents(
  prisma: PrismaClient,
  input: ReplayRealtimeEventsInput,
) {
  validateScope(input.audience, input.channel);
  const afterSequence = normalizeCursor(input.afterSequence);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), MAX_REPLAY_PAGE_SIZE);
  const scope = {
    audienceType: input.audience.type,
    audienceId: input.audience.id,
    channel: input.channel,
  };
  const now = new Date();

  const [earliestRetained, counter] = await Promise.all([
    prisma.realtimeEvent.findFirst({
      where: { ...scope, expiresAt: { gt: now } },
      orderBy: { sequence: 'asc' },
      select: { sequence: true },
    }),
    prisma.realtimeChannelSequence.findUnique({
      where: { audienceType_audienceId_channel: scope },
      select: { nextSequence: true },
    }),
  ]);

  const latestSequence = counter?.nextSequence ?? 0n;
  const cursorExpired = earliestRetained
    ? afterSequence < earliestRetained.sequence - 1n
    : afterSequence < latestSequence;

  if (cursorExpired) {
    return {
      events: [],
      nextCursor: afterSequence,
      hasMore: false,
      cursorExpired: true,
      resyncRequired: true,
    };
  }

  const events = await prisma.realtimeEvent.findMany({
    where: { ...scope, sequence: { gt: afterSequence }, expiresAt: { gt: now } },
    orderBy: { sequence: 'asc' },
    take: limit + 1,
  });
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  return {
    events: page,
    nextCursor: page.length ? page[page.length - 1].sequence : afterSequence,
    hasMore,
    cursorExpired: false,
    resyncRequired: false,
  };
}

/** Retention worker primitive. Schedule it from an existing maintenance worker. */
export async function deleteExpiredRealtimeEvents(prisma: PrismaClient, now = new Date()) {
  return prisma.realtimeEvent.deleteMany({ where: { expiresAt: { lte: now } } });
}
