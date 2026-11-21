import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { buildCommsProviderEventKey } from './outboundDispatch.js';

export interface AppendCommsDeliveryReceiptInput {
  dispatchId: string;
  communicationMessageId: string;
  providerMessageId: string;
  providerStatus: string;
  deliveryState: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Append one immutable provider event. Duplicate callback payloads are replayed
 * by key and never update an existing receipt row.
 */
export async function appendCommsDeliveryReceipt(
  prisma: PrismaClient,
  input: AppendCommsDeliveryReceiptInput,
): Promise<{ receiptId: string; replayed: boolean }> {
  if (!input.providerMessageId || !input.providerStatus || !input.deliveryState) {
    throw new Error('Provider message ID, status, and delivery state are required.');
  }

  const providerEventKey = buildCommsProviderEventKey({
    providerMessageId: input.providerMessageId,
    providerStatus: input.providerStatus,
    deliveryState: input.deliveryState,
    metadata: input.metadata,
  });

  const existing = await prisma.commsDeliveryReceipt.findUnique({
    where: { providerEventKey },
    select: { id: true },
  });
  if (existing) return { receiptId: existing.id, replayed: true };

  const created = await prisma.commsDeliveryReceipt.create({
    data: {
      dispatchId: input.dispatchId,
      communicationMessageId: input.communicationMessageId,
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
      deliveryState: input.deliveryState,
      providerEventKey,
      providerReferenceHash: createHash('sha256').update(input.providerMessageId).digest('hex'),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
    select: { id: true },
  });

  return { receiptId: created.id, replayed: false };
}

/**
 * Replays are safe even when two authenticated provider callbacks race on the
 * same event key. The unique constraint is the final concurrency boundary.
 */
export async function appendCommsDeliveryReceiptIdempotent(
  prisma: PrismaClient,
  input: AppendCommsDeliveryReceiptInput,
): Promise<{ receiptId: string; replayed: boolean }> {
  try {
    return await appendCommsDeliveryReceipt(prisma, input);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code : undefined;
    if (code !== 'P2002') throw error;
    const providerEventKey = buildCommsProviderEventKey({
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
      deliveryState: input.deliveryState,
      metadata: input.metadata,
    });
    const existing = await prisma.commsDeliveryReceipt.findUnique({
      where: { providerEventKey },
      select: { id: true },
    });
    if (!existing) throw error;
    return { receiptId: existing.id, replayed: true };
  }
}
