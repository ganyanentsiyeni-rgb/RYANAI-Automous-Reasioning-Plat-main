import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildCommsProviderEventKey,
  claimOutboundCommsDispatch,
  markOutboundCommsDispatchAccepted,
  markOutboundCommsDispatchUncertain,
  advanceOutboundCommsDispatchFromReceipt,
  reconcileOutboundCommsDispatch,
  reconcileStaleOutboundCommsDispatches,
  reserveOutboundCommsDispatch,
} from './outboundDispatch.js';
import { appendCommsDeliveryReceiptIdempotent } from './deliveryReceipts.js';

describe('outbound Comms dispatch', () => {
  it('uses a conditional state transition so a late accepted receipt cannot overwrite delivered', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ state: 'delivered' });
    const prisma = { outboundCommsDispatch: { findUnique, updateMany } } as unknown as PrismaClient;

    await advanceOutboundCommsDispatchFromReceipt(prisma, {
      dispatchId: 'dispatch-delivered',
      deliveryState: 'accepted',
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'dispatch-delivered',
        state: { in: ['reserved', 'dispatching', 'accepted', 'uncertain'] },
      },
      data: expect.objectContaining({ state: 'accepted' }),
    }));
  });

  it('allows an authoritative delivered receipt to supersede failed but blocks failed after delivered', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({ state: 'failed' });
    const prisma = { outboundCommsDispatch: { findUnique, updateMany } } as unknown as PrismaClient;

    await advanceOutboundCommsDispatchFromReceipt(prisma, {
      dispatchId: 'dispatch-failed',
      deliveryState: 'delivered',
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'dispatch-failed',
        state: { in: ['reserved', 'dispatching', 'accepted', 'uncertain', 'failed'] },
      },
      data: expect.objectContaining({ state: 'delivered' }),
    }));
  });

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
      provider: 'twilio',
    });

    await expect(reserveOutboundCommsDispatch(prisma, {
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
      idempotencyKey: 'outbound-key-0001',
      provider: 'twilio',
    })).resolves.toMatchObject({ id: 'dispatch-1', replayed: true });

    create.mockRejectedValueOnce({ code: 'P2002' });
    findUnique.mockResolvedValueOnce({
      id: 'dispatch-1', state: 'reserved', providerMessageId: null,
      communicationMessageId: 'message-1', agentRunId: 'run-1',
      channel: 'sms', recipient: '+27710000000', provider: 'twilio',
    });
    await expect(reserveOutboundCommsDispatch(prisma, {
      communicationMessageId: 'message-1', agentRunId: 'run-1',
      channel: 'sms', recipient: '+27710000000',
      idempotencyKey: 'outbound-key-0001', provider: 'resend',
    })).rejects.toThrow('already bound to a different dispatch');
      id: 'dispatch-1',
      state: 'reserved',
      providerMessageId: null,
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
      provider: 'another-provider',
    });
    await expect(reserveOutboundCommsDispatch(prisma, {
      communicationMessageId: 'message-1',
      agentRunId: 'run-1',
      channel: 'sms',
      recipient: '+27710000000',
      idempotencyKey: 'outbound-key-0001',
      provider: 'twilio',
    })).rejects.toThrow('already bound to a different dispatch.');
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

  it('does not let a late provider send response downgrade a terminal dispatch receipt', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { outboundCommsDispatch: { updateMany } } as unknown as PrismaClient;
    await markOutboundCommsDispatchAccepted(prisma, { dispatchId: 'dispatch-terminal', providerMessageId: 'SM' + 'a'.repeat(32) });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dispatch-terminal', state: { in: ['reserved', 'dispatching', 'uncertain', 'accepted'] } },
      data: expect.objectContaining({ state: 'accepted' }),
    }));
  });

  it('only marks a dispatch uncertain while it is still dispatching', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { outboundCommsDispatch: { updateMany } } as unknown as PrismaClient;
    await markOutboundCommsDispatchUncertain(prisma, 'dispatch-delivered', 'late provider error');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dispatch-delivered', state: 'dispatching' },
      data: expect.objectContaining({ state: 'uncertain' }),
    }));
  });

  it('uses atomic state predicates so out-of-order receipts cannot downgrade delivery', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn();
    const prisma = { outboundCommsDispatch: { updateMany, findUnique } } as unknown as PrismaClient;
    await advanceOutboundCommsDispatchFromReceipt(prisma, { dispatchId: 'dispatch-4', deliveryState: 'delivered' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dispatch-4', state: { in: ['reserved', 'dispatching', 'accepted', 'uncertain', 'failed', 'delivered'] } },
      data: expect.objectContaining({ state: 'delivered' }),
    }));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['queued', 'unknown'])('does not promote a dispatch on a %s provider callback', async (deliveryState) => {
    const updateMany = vi.fn();
    const findUnique = vi.fn();
    const prisma = { outboundCommsDispatch: { updateMany, findUnique } } as unknown as PrismaClient;

    await advanceOutboundCommsDispatchFromReceipt(prisma, { dispatchId: 'dispatch-pending', deliveryState });

    expect(updateMany).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('advances voice call completion only to provider acceptance, never delivery', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { outboundCommsDispatch: { updateMany } } as unknown as PrismaClient;

    await advanceOutboundCommsDispatchFromReceipt(prisma, { dispatchId: 'voice-dispatch', deliveryState: 'accepted_by_provider' });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'voice-dispatch', state: { in: ['reserved', 'dispatching', 'accepted', 'uncertain'] } },
      data: expect.objectContaining({ state: 'accepted' }),
    }));
    expect(updateMany.mock.calls[0][0].data.state).not.toBe('delivered');
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
      outboundCommsDispatch: { findUnique: vi.fn().mockResolvedValue({ communicationMessageId: 'message-1', providerMessageId: 'SM' + 'a'.repeat(32) }) },
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
      metadata: { callbackAttempt: 2 },
    }));
  });
});
