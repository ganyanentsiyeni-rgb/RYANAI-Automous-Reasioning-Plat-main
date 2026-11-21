import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export type OutboundCommsDispatchState =
  | 'reserved'
  | 'dispatching'
  | 'accepted'
  | 'uncertain'
  | 'failed'
  | 'reconciled';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export interface ReserveOutboundCommsDispatchInput {
  communicationMessageId: string;
  agentRunId?: string | null;
  channel: string;
  recipient: string;
  idempotencyKey: string;
  provider: string;
  metadata?: Prisma.InputJsonObject;
}

export interface OutboundCommsDispatchResult {
  id: string;
  state: string;
  providerMessageId: string | null;
  replayed: boolean;
}

/**
 * Creates the provider-dispatch state independently from AgentRun execution.
 * The AgentRun ID is attribution only; this function never changes AgentRun state.
 */
export async function reserveOutboundCommsDispatch(
  prisma: PrismaClient,
  input: ReserveOutboundCommsDispatchInput,
): Promise<OutboundCommsDispatchResult> {
  try {
    const created = await prisma.outboundCommsDispatch.create({
      data: {
        communicationMessageId: input.communicationMessageId,
        agentRunId: input.agentRunId ?? null,
        channel: input.channel,
        recipient: input.recipient,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        state: 'reserved',
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      select: { id: true, state: true, providerMessageId: true },
    });
    return { ...created, replayed: false };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code : undefined;
    if (code !== 'P2002') throw error;

    const existing = await prisma.outboundCommsDispatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        state: true,
        providerMessageId: true,
        communicationMessageId: true,
        agentRunId: true,
        channel: true,
        recipient: true,
      },
    });
    if (!existing) throw error;

    if (
      existing.communicationMessageId !== input.communicationMessageId
      || existing.channel !== input.channel
      || existing.recipient !== input.recipient
      || (existing.agentRunId ?? null) !== (input.agentRunId ?? null)
    ) {
      throw new Error('This outbound idempotency key is already bound to a different dispatch.');
    }

    return {
      id: existing.id,
      state: existing.state,
      providerMessageId: existing.providerMessageId,
      replayed: true,
    };
  }
}

/**
 * Atomically claim a reserved dispatch. A stale in-flight dispatch is moved
 * to uncertain instead of being sent again. No automatic retry is permitted.
 */
export async function claimOutboundCommsDispatch(
  prisma: PrismaClient,
  dispatchId: string,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Promise<{ id: string; state: OutboundCommsDispatchState; replayed: boolean }> {
  const current = await prisma.outboundCommsDispatch.findUnique({
    where: { id: dispatchId },
    select: { id: true, state: true, updatedAt: true },
  });
  if (!current) throw new Error('Outbound dispatch was not found.');

  if (current.state === 'dispatching') {
    const stale = Date.now() - current.updatedAt.getTime() >= staleAfterMs;
    if (stale) {
      const marked = await prisma.outboundCommsDispatch.updateMany({
        where: { id: dispatchId, state: 'dispatching', updatedAt: { lte: new Date(Date.now() - staleAfterMs) } },
        data: { state: 'uncertain', uncertainAt: new Date() },
      });
      if (marked.count === 1) return { id: dispatchId, state: 'uncertain', replayed: true };
    }
    return { id: dispatchId, state: 'dispatching', replayed: true };
  }

  if (current.state !== 'reserved') {
    return { id: dispatchId, state: current.state as OutboundCommsDispatchState, replayed: true };
  }

  const claimed = await prisma.outboundCommsDispatch.updateMany({
    where: { id: dispatchId, state: 'reserved' },
    data: {
      state: 'dispatching',
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    const reread = await prisma.outboundCommsDispatch.findUnique({
      where: { id: dispatchId },
      select: { id: true, state: true },
    });
    if (!reread) throw new Error('Outbound dispatch disappeared during claim.');
    return { id: reread.id, state: reread.state as OutboundCommsDispatchState, replayed: true };
  }

  return { id: dispatchId, state: 'dispatching', replayed: false };
}

export async function markOutboundCommsDispatchAccepted(
  prisma: PrismaClient,
  input: { dispatchId: string; providerMessageId: string },
): Promise<void> {
  if (!input.providerMessageId) throw new Error('Provider message ID is required for acceptance.');
  await prisma.outboundCommsDispatch.update({
    where: { id: input.dispatchId },
    data: {
      providerMessageId: input.providerMessageId,
      state: 'accepted',
      updatedAt: new Date(),
    },
  });
}

export async function markOutboundCommsDispatchUncertain(
  prisma: PrismaClient,
  dispatchId: string,
  reason: string,
): Promise<void> {
  await prisma.outboundCommsDispatch.update({
    where: { id: dispatchId },
    data: {
      state: 'uncertain',
      uncertainAt: new Date(),
      reconciliationReason: reason,
    },
  });
}

export async function reconcileOutboundCommsDispatch(
  prisma: PrismaClient,
  input: {
    dispatchId: string;
    operatorId: string;
    state: 'accepted' | 'failed' | 'reconciled';
    providerMessageId?: string;
    reason: string;
  },
): Promise<void> {
  if (!input.operatorId || !input.reason.trim()) {
    throw new Error('Explicit operator identity and reconciliation reason are required.');
  }
  await prisma.outboundCommsDispatch.update({
    where: { id: input.dispatchId, state: 'uncertain' },
    data: {
      state: input.state,
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
      reconciledAt: new Date(),
      reconciledBy: input.operatorId,
      reconciliationReason: input.reason.trim(),
    },
  });
}

/**
 * Converts stale in-flight dispatches to uncertain. This is deliberately a
 * recovery action only: it never contacts a provider and never resends.
 */
export async function reconcileStaleOutboundCommsDispatches(
  prisma: PrismaClient,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Promise<number> {
  const result = await prisma.outboundCommsDispatch.updateMany({
    where: {
      state: 'dispatching',
      updatedAt: { lte: new Date(Date.now() - staleAfterMs) },
    },
    data: {
      state: 'uncertain',
      uncertainAt: new Date(),
      reconciliationReason: 'stale_in_flight_without_provider_confirmation',
    },
  });
  return result.count;
}

export function buildCommsProviderEventKey(input: {
  providerMessageId: string;
  providerStatus: string;
  deliveryState: string;
  metadata?: unknown;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
      deliveryState: input.deliveryState,
      metadata: input.metadata ?? null,
    }))
    .digest('hex');
}
