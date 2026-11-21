import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildCommsProviderEventKey,
  claimOutboundCommsDispatch,
  reconcileOutboundCommsDispatch,
  reconcileStaleOutboundCommsDispatches,
  reserveOutboundCommsDispatch,
} from './outboundDispatch.js';
import { appendCommsDeliveryReceiptIdempotent } from './deliveryReceipts.js';

describe('outbound Comms dispatch', () => {
  it('deduplicates outbound idempotency reservations', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'dispatch-1', state: 'reserved', providerMessageId: null });
    const findUnique = vi.fn();
    const prisma = {
      outboundCommsDispatch: { create, findUnique, updateMany: vi.fn() },
    } as unknown as PrismaClient;

    await expect(reserveOutboundCommsDispatch(prisma, {
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
      idempotencyKey: 'outbound-key-0001',
      provider: 'twilio',
    })).resolves.toEqual({ id: 'dispatch-1', state: 'reserved', providerMessageId: null, replayed: false });

    create.mockRejectedValueOnce({ code: 'P2002' });
    findUnique.mockResolvedValueOnce({
      id: 'dispatch-1',
      state: 'reserved',
      providerMessageId: null,
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
    });

    await expect(reserveOutboundCommsDispatch(prisma, {
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
      idempotencyKey: 'outbound-key-0001',
      provider: 'twilio',
    })).resolves.toMatchObject({ id: 'dispatch-1', replayed: true });
  });

  it('moves stale in-flight dispatches to uncertain instead of retrying', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'dispatch-2',
      state: 'dispatching',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { outboundCommsDispatch: { findUnique, updateMany } } as unknown as PrismaClient;

    await expect(claimOutboundCommsDispatch(prisma, 'dispatch-2', 5 * 60 * 1000))
      .resolves.toEqual({ id: 'dispatch-2', state: 'uncertain', replayed: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'dispatch-2', state: 'dispatching' }),
      data: expect.objectContaining({ state: 'uncertain' }),
    }));
  });

  it('requires explicit operator reconciliation before an uncertain dispatch can become resolved', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { outboundCommsDispatch: { updateMany } } as unknown as PrismaClient;

    await expect(reconcileOutboundCommsDispatch(prisma, {
      dispatchId: 'dispatch-3',
      operatorId: 'owner-1',
      state: 'accepted',
      providerMessageId: 'SM' + 'a'.repeat(32),
      reason: 'Provider dashboard confirmed acceptance.',
    })).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dispatch-3', state: 'uncertain' },
    }));
  });

  it('marks stale dispatches uncertain without contacting a provider', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = { outboundCommsDispatch: { updateMany } } as unknown as PrismaClient;

    await expect(reconcileStaleOutboundCommsDispatches(prisma, 60_000)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ state: 'dispatching' }),
      data: expect.objectContaining({ state: 'uncertain' }),
    }));
  });
});

describe('append-only Comms delivery receipts', () => {
  it('deduplicates the same authenticated provider callback without updating the prior receipt', async () => {
    const existing = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 'receipt-1' });
    const prisma = {
      commsDeliveryReceipt: { findUnique: existing, create },
    } as unknown as PrismaClient;

    const input = {
      dispatchId: 'dispatch-1',
      communicationMessageId: 'message-1',
      providerMessageId: 'SM' + 'a'.repeat(32),
      providerStatus: 'delivered',
      deliveryState: 'delivered',
      metadata: { errorCode: null },
    };

    await expect(appendCommsDeliveryReceiptIdempotent(prisma, input))
      .resolves.toEqual({ receiptId: 'receipt-1', replayed: false });

    existing.mockResolvedValueOnce({ id: 'receipt-1' });
    await expect(appendCommsDeliveryReceiptIdempotent(prisma, input))
      .resolves.toEqual({ receiptId: 'receipt-1', replayed: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('uses a deterministic provider event key for replay protection', () => {
    const key = buildCommsProviderEventKey({
      providerMessageId: 'SM' + 'a'.repeat(32),
      providerStatus: 'delivered',
      deliveryState: 'delivered',
      metadata: { errorCode: null },
    });
    expect(key).toHaveLength(64);
    expect(key).toBe(buildCommsProviderEventKey({
      providerMessageId: 'SM' + 'a'.repeat(32),
      providerStatus: 'delivered',
      deliveryState: 'delivered',
      metadata: { errorCode: null },
    }));
  });
});
