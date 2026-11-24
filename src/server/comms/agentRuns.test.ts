import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, appendRunEvidence, captureQueueTraceContextForStorage, publishAgentTaskNotification, waitForAutonomousTask } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    agentRun: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
  appendRunEvidence: vi.fn(),
  captureQueueTraceContextForStorage: vi.fn(() => ({ traceId: 'trace-test' })),
  publishAgentTaskNotification: vi.fn(),
  waitForAutonomousTask: vi.fn(),
}));
const tx = {
  agentRun: { create: vi.fn() },
  agentHandoff: { createMany: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../agent/engineeringEvidence.js', () => ({ appendRunEvidence }));
vi.mock('../../telemetry/queueContext.js', () => ({ captureQueueTraceContextForStorage }));
vi.mock('../../agent/queueNotifications.js', () => ({ publishAgentTaskNotification }));
vi.mock('../../agent/operations.js', () => ({ waitForAutonomousTask }));

import { enqueueCommsAssistRun } from './agentRuns.js';

describe('enqueueCommsAssistRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.agentRun.create.mockResolvedValue({ id: 'comms_assist_abc', userId: 'owner-1', objective: 'Internal Comms task', status: 'queued' });
    tx.agentHandoff.createMany.mockResolvedValue({ count: 4 });
    appendRunEvidence.mockResolvedValue({ id: 'evidence-1' });
    publishAgentTaskNotification.mockResolvedValue(true);
    prismaMock.$queryRaw.mockResolvedValue([]);
  });

  it('creates an owner-scoped, approved internal Comms task with durable handoffs', async () => {
    const result = await enqueueCommsAssistRun({
      ownerUserId: 'owner-1',
      idempotencyKey: 'pa-delegation:delegation-1',
      objective: 'Internal Comms task',
    });

    expect(tx.agentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'owner-1',
        objective: 'Internal Comms task',
        status: 'queued',
        approvalStatus: 'approved',
        approvedBy: 'owner-1',
        executionScope: expect.objectContaining({ source: 'internal-comms-assist' }),
      }),
    }));
    expect(tx.agentHandoff.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ fromAgent: 'comms', toAgent: 'primary' }),
        expect.objectContaining({ fromAgent: 'comms', toAgent: 'secondary' }),
      ]),
    }));
    expect(appendRunEvidence).toHaveBeenCalledWith(tx, expect.objectContaining({
      runId: 'comms_assist_abc',
      eventType: 'comms.assist.queued',
      payload: expect.objectContaining({ outboundDispatchAllowed: false }),
    }));
    expect(publishAgentTaskNotification).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ runId: 'comms_assist_abc', status: 'queued', replayed: false, notified: true });
  });

  it('rejects an idempotency replay with a different owner or objective', async () => {
    tx.agentRun.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.agentRun.findUnique.mockResolvedValueOnce({
      id: 'comms_assist_existing',
      userId: 'another-owner',
      objective: 'Different objective',
      status: 'queued',
      approvalStatus: 'approved',
    });

    await expect(enqueueCommsAssistRun({
      ownerUserId: 'owner-1',
      idempotencyKey: 'pa-delegation:delegation-1',
      objective: 'Internal Comms task',
    })).rejects.toThrow(/idempotency conflict/);
    expect(publishAgentTaskNotification).not.toHaveBeenCalled();
  });
});
