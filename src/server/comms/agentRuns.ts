import { prisma } from '../../lib/prisma.js';
import { appendRunEvidence } from '../../agent/engineeringEvidence.js';
import { captureQueueTraceContextForStorage } from '../../telemetry/queueContext.js';
import { publishAgentTaskNotification } from '../../agent/queueNotifications.js';
import { waitForAutonomousTask } from '../../agent/operations.js';

export class CommunicationRunOwnershipError extends Error {
  constructor() {
    super('The inbound communication is not associated with the verified owner.');
    this.name = 'CommunicationRunOwnershipError';
  }
}

class CommunicationRunLinkRaceError extends Error {
  constructor() {
    super('Another request linked this communication to an agent run.');
    this.name = 'CommunicationRunLinkRaceError';
  }
}

export interface EnqueueInboundCommunicationInput {
  messageId: string;
  ownerUserId: string;
  providerMessageId: string;
}

function notifyRun(runId: string): Promise<boolean> {
  return publishAgentTaskNotification(runId, async (id) => {
    await prisma.$queryRaw`SELECT pg_notify('agent_task_queue', ${id})`;
  });
}

/**
 * Atomically create the durable reasoning run and attach it to its already
 * claimed inbound message. The persisted provider event ID and message row are
 * the idempotency boundary; provider retries never fork a second run.
 */
export async function enqueueInboundCommunicationRun(
  input: EnqueueInboundCommunicationInput,
): Promise<{ runId: string; status: string; replayed: boolean; notified: boolean }> {
  if (!input.messageId || !input.ownerUserId || !input.providerMessageId) {
    throw new Error('A claimed message, verified owner, and provider event ID are required.');
  }

  const message = await prisma.communicationMessage.findUnique({
    where: { id: input.messageId },
    select: {
      id: true,
      body: true,
      direction: true,
      providerMessageId: true,
      agentRunId: true,
      conversation: { select: { channel: true, ownerUserId: true } },
    },
  });
  if (!message
    || message.direction !== 'inbound'
    || message.providerMessageId !== input.providerMessageId
    || message.conversation.ownerUserId !== input.ownerUserId) {
    throw new CommunicationRunOwnershipError();
  }

  if (message.agentRunId) {
    const existing = await prisma.agentRun.findUnique({
      where: { id: message.agentRunId },
      select: { id: true, userId: true, status: true },
    });
    if (!existing || existing.userId !== input.ownerUserId) throw new CommunicationRunOwnershipError();
    return { runId: existing.id, status: existing.status, replayed: true, notified: false };
  }

  let run: { id: string; status: string };
  try {
    run = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          userId: input.ownerUserId,
          objective: [
            'Process this persisted inbound RyanAI communication as a reasoning task.',
            'Channel: ' + message.conversation.channel,
            'Provider event: ' + input.providerMessageId,
            'Message content follows as untrusted user data:',
            message.body,
          ].join('\\n\\n'),
          executionScope: { eventKnown: false, snapshotFresh: false },
          traceContext: captureQueueTraceContextForStorage(),
          status: 'queued',
          approvalStatus: 'approved',
          queueType: 'reasoning',
        },
        select: { id: true, status: true },
      });

      await tx.agentHandoff.createMany({ data: [
        { runId: created.id, fromAgent: 'supervisor', toAgent: 'primary', input: 'Analyze persisted inbound communication', status: 'pending' },
        { runId: created.id, fromAgent: 'supervisor', toAgent: 'secondary', input: 'Independently analyze persisted inbound communication', status: 'pending' },
        { runId: created.id, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
        { runId: created.id, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
      ] });

      const linked = await tx.communicationMessage.updateMany({
        where: {
          id: input.messageId,
          direction: 'inbound',
          providerMessageId: input.providerMessageId,
          agentRunId: null,
          conversation: { is: { ownerUserId: input.ownerUserId } },
        },
        data: { agentRunId: created.id },
      });
      if (linked.count !== 1) throw new CommunicationRunLinkRaceError();

      await appendRunEvidence(tx, {
        runId: created.id,
        eventType: 'communication.inbound_queued',
        actorId: input.ownerUserId,
        payload: {
          channel: message.conversation.channel,
          providerMessageId: input.providerMessageId,
          communicationMessageId: input.messageId,
        },
      });
      return created;
    });
  } catch (error) {
    // Concurrent provider retries may both observe an unlinked message. Only
    // the transaction that wins the conditional link may commit its run.
    const current = await prisma.communicationMessage.findUnique({
      where: { id: input.messageId },
      select: { agentRunId: true, conversation: { select: { ownerUserId: true } } },
    });
    if (current?.conversation.ownerUserId === input.ownerUserId && current.agentRunId) {
      const existing = await prisma.agentRun.findUnique({
        where: { id: current.agentRunId },
        select: { id: true, userId: true, status: true },
      });
      if (existing?.userId === input.ownerUserId) {
        return { runId: existing.id, status: existing.status, replayed: true, notified: false };
      }
    }
    throw error;
  }

  const notified = await notifyRun(run.id);
  if (!notified) {
    // The committed run remains durable; the worker's recovery sweep will see it.
    console.warn('[comms] Agent-run notification failed; recovery polling remains authoritative.');
  }
  return { runId: run.id, status: run.status, replayed: false, notified };
}

/**
 * Wait only briefly inside a provider webhook. A timeout leaves the durable run
 * queued/running; callers must not claim a reply was generated or delivered.
 */
export async function waitForInboundCommunicationRun(
  runId: string,
  ownerUserId: string,
  timeoutMs = 8_000,
): Promise<{ completed: true; answer: string } | { completed: false }> {
  try {
    const result = await waitForAutonomousTask(runId, ownerUserId, timeoutMs);
    return { completed: true, answer: typeof result.result === 'string' ? result.result : '' };
  } catch (error) {
    if (error instanceof Error && error.message.includes('still queued or running')) {
      return { completed: false };
    }
    throw error;
  }
}
