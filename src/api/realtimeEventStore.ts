import { Prisma, PrismaClient } from '@prisma/client';

export type RealtimeRole = 'user' | 'admin';

export interface RealtimePrincipal {
  userId: string;
  role: RealtimeRole;
}

export interface RealtimeAudience {
  type: 'user' | 'admin';
  id: string;
}

export interface RealtimeEventInput {
  channel: string;
  eventType: string;
  payload: unknown;
}

export interface RealtimeReplayPage {
  events: Array<{
    id: string;
    channel: string;
    sequence: string;
    eventType: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }>;
  nextCursor: string;
  hasMore: boolean;
  cursorExpired: boolean;
  resyncRequired: boolean;
}

const RETENTION_DAYS = 7;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

// Explicit allowlist: unknown channels are denied. Admin events are shared only
// with authenticated administrators; user events are isolated by verified ID.
const CHANNEL_ACCESS: Record<string, RealtimeRole> = {
  'metrics': 'admin',
  'system.health': 'admin',
  'admin.notifications': 'admin',
  'user.notifications': 'user',
  'user.tasks': 'user',
};

export function authorizeRealtimeChannel(
  principal: RealtimePrincipal,
  channel: string,
): RealtimeAudience | null {
  const requiredRole = CHANNEL_ACCESS[channel];
  if (!requiredRole) return null;
  if (requiredRole === 'admin' && principal.role !== 'admin') return null;
  if (requiredRole === 'user' && !principal.userId) return null;

  return requiredRole === 'admin'
    ? { type: 'admin', id: 'global' }
    : { type: 'user', id: principal.userId };
}

export class RealtimeEventStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly retentionDays = RETENTION_DAYS,
  ) {}

  /**
   * Allocate the next sequence and persist the event in one transaction.
   * Callers must broadcast only after this promise resolves.
   */
  async append(
    audience: RealtimeAudience,
    input: RealtimeEventInput,
  ): Promise<{ id: string; sequence: string; createdAt: Date; expiresAt: Date }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.retentionDays * 86_400_000);

    return this.db.$transaction(async (tx) => {
      const counter = await tx.realtimeChannelSequence.upsert({
        where: {
          audienceType_audienceId_channel: {
            audienceType: audience.type,
            audienceId: audience.id,
            channel: input.channel,
          },
        },
        create: {
          audienceType: audience.type,
          audienceId: audience.id,
          channel: input.channel,
          nextSequence: 1n,
        },
        update: { nextSequence: { increment: 1n } },
        select: { nextSequence: true },
      });

      const event = await tx.realtimeEvent.create({
        data: {
          audienceType: audience.type,
          audienceId: audience.id,
          channel: input.channel,
          sequence: counter.nextSequence,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
          createdAt: now,
          expiresAt,
        },
        select: { id: true, sequence: true, createdAt: true, expiresAt: true },
      });

      return { ...event, sequence: event.sequence.toString() };
    });
  }

  async replay(
    audience: RealtimeAudience,
    channel: string,
    cursor: string,
    requestedLimit = DEFAULT_PAGE_SIZE,
    now = new Date(),
  ): Promise<RealtimeReplayPage> {
    if (!/^\d+$/.test(cursor)) throw new Error('Invalid realtime cursor');
    const after = BigInt(cursor);
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_PAGE_SIZE);

    const [counter, oldest] = await Promise.all([
      this.db.realtimeChannelSequence.findUnique({
        where: {
          audienceType_audienceId_channel: {
            audienceType: audience.type,
            audienceId: audience.id,
            channel,
          },
        },
        select: { nextSequence: true },
      }),
      this.db.realtimeEvent.findFirst({
        where: {
          audienceType: audience.type,
          audienceId: audience.id,
          channel,
          expiresAt: { gt: now },
        },
        orderBy: { sequence: 'asc' },
        select: { sequence: true },
      }),
    ]);

    const latest = counter?.nextSequence ?? 0n;
    if (after > latest) throw new Error('Realtime cursor is ahead of the channel');

    const cursorExpired = oldest
      ? after < oldest.sequence - 1n
      : after < latest;

    if (cursorExpired) {
      return {
        events: [],
        nextCursor: latest.toString(),
        hasMore: false,
        cursorExpired: true,
        resyncRequired: true,
      };
    }

    const rows = await this.db.realtimeEvent.findMany({
      where: {
        audienceType: audience.type,
        audienceId: audience.id,
        channel,
        sequence: { gt: after },
        expiresAt: { gt: now },
      },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        channel: true,
        sequence: true,
        eventType: true,
        payload: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      events: page.map((event) => ({ ...event, sequence: event.sequence.toString() })),
      nextCursor: last ? last.sequence.toString() : after.toString(),
      hasMore,
      cursorExpired: false,
      resyncRequired: false,
    };
  }

  async pruneExpired(now = new Date()): Promise<number> {
    const result = await this.db.realtimeEvent.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  }
}
