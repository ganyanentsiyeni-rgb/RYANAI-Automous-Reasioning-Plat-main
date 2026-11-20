import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  authorizeRealtimeChannel,
  RealtimeEventStore,
  type RealtimeAudience,
} from './realtimeEventStore';

const admin = { userId: 'admin-1', role: 'admin' as const };
const user = { userId: 'user-1', role: 'user' as const };

describe('realtime channel authorization', () => {
  it('denies unknown channels and prevents users subscribing to admin channels', () => {
    expect(authorizeRealtimeChannel(admin, 'unregistered.channel')).toBeNull();
    expect(authorizeRealtimeChannel(user, 'metrics')).toBeNull();
  });

  it('scopes user channels to the verified principal ID', () => {
    expect(authorizeRealtimeChannel(user, 'user.notifications')).toEqual({
      type: 'user',
      id: 'user-1',
    });
  });

  it('uses a shared admin audience only for allowlisted admin channels', () => {
    expect(authorizeRealtimeChannel(admin, 'metrics')).toEqual({
      type: 'admin',
      id: 'global',
    });
  });
});

describe('RealtimeEventStore', () => {
  it('allocates a sequence and persists the event in the same transaction', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'event-1',
      sequence: 8n,
      createdAt: new Date('2026-11-21T00:00:00Z'),
      expiresAt: new Date('2026-11-28T00:00:00Z'),
    });
    const upsert = vi.fn().mockResolvedValue({ nextSequence: 8n });
    const db = {
      $transaction: vi.fn(async (callback) => callback({
        realtimeChannelSequence: { upsert },
        realtimeEvent: { create },
      })),
    } as unknown as PrismaClient;
    const audience: RealtimeAudience = { type: 'user', id: 'user-1' };

    const result = await new RealtimeEventStore(db).append(audience, {
      channel: 'user.notifications',
      eventType: 'notification.created',
      payload: { message: 'Ready' },
    });

    expect(upsert).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.sequence).toBe(8n);
    expect(result.sequence).toBe('8');
  });

  it('does not expose another audience when replaying', async () => {
    const findUnique = vi.fn().mockResolvedValue({ nextSequence: 3n });
    const findFirst = vi.fn().mockResolvedValue({ sequence: 1n });
    const findMany = vi.fn().mockResolvedValue([]);
    const db = {
      realtimeChannelSequence: { findUnique },
      realtimeEvent: { findFirst, findMany },
    } as unknown as PrismaClient;

    await new RealtimeEventStore(db).replay(
      { type: 'user', id: 'user-1' },
      'user.notifications',
      '1',
    );

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      audienceType: 'user',
      audienceId: 'user-1',
      channel: 'user.notifications',
    });
  });

  it('returns an explicit resync requirement when the cursor has expired', async () => {
    const db = {
      realtimeChannelSequence: {
        findUnique: vi.fn().mockResolvedValue({ nextSequence: 9n }),
      },
      realtimeEvent: {
        findFirst: vi.fn().mockResolvedValue({ sequence: 5n }),
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;

    const page = await new RealtimeEventStore(db).replay(
      { type: 'admin', id: 'global' },
      'metrics',
      '2',
    );

    expect(page).toMatchObject({
      events: [],
      nextCursor: '9',
      cursorExpired: true,
      resyncRequired: true,
    });
    expect(db.realtimeEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed and future cursors', async () => {
    const db = {
      realtimeChannelSequence: {
        findUnique: vi.fn().mockResolvedValue({ nextSequence: 4n }),
      },
      realtimeEvent: {
        findFirst: vi.fn().mockResolvedValue({ sequence: 1n }),
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;
    const store = new RealtimeEventStore(db);
    const audience = { type: 'admin' as const, id: 'global' };

    await expect(store.replay(audience, 'metrics', '-1')).rejects.toThrow('Invalid realtime cursor');
    await expect(store.replay(audience, 'metrics', '5')).rejects.toThrow('ahead of the channel');
  });
});
