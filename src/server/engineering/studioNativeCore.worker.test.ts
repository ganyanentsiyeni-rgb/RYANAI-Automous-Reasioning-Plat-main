import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  taskFindMany: vi.fn(),
  taskUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
  directTaskUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    studioTask: { updateMany: mocks.directTaskUpdateMany },
    studioEvent: { create: mocks.eventCreate },
  },
}));

import { recoverExpiredStudioLeases, registerStudioTaskHandler, runStudioWorkerOnce } from './studioNativeCore.js';

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  projectId: 'project-1',
  ownerUserId: 'owner-1',
  taskType: 'ci-failure',
  assignedWorkerId: 'ci-diagnostics',
  requiredCapabilities: ['read-workflow-runs'],
  approvalRequired: false,
  approvalStatus: 'not_required',
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  ...overrides,
});

describe('Studio worker queue lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const transactionClient = {
      $queryRawUnsafe: mocks.queryRawUnsafe,
      studioTask: { findMany: mocks.taskFindMany, updateMany: mocks.taskUpdateMany },
      studioEvent: { create: mocks.eventCreate },
    };
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient));
    mocks.queryRawUnsafe.mockResolvedValue([task()]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.directTaskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventCreate.mockResolvedValue({});
  });

  it('blocks a task whose requested capabilities exceed its assigned RyanAI worker', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({ requiredCapabilities: ['production.deploy'] })]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'blocked', approvalStatus: 'blocked' }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_blocked' }),
      }));
    } finally {
      unregister();
    }
  });

  it('blocks a task until its persisted owner approval is approved', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({ approvalRequired: true, approvalStatus: 'pending' })]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_blocked' }),
      }));
    } finally {
      unregister();
    }
  });

  it('keeps policy-denied work blocked and never invokes its handler', async () => {
    const handler = vi.fn();
    const unregister = registerStudioTaskHandler('studio.test', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'blocked', approvalStatus: 'blocked' }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_blocked' }),
      }));
    } finally {
      unregister();
    }
  });

  it('retries handler failures with an execution-failed event', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('temporary handler fault'));
    const unregister = registerStudioTaskHandler('studio.test', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'failed', taskId: 'task-1', error: 'temporary handler fault' });
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'queued', leaseOwner: null, leaseExpiresAt: null }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.execution_failed' }),
      }));
    } finally {
      unregister();
    }
  });

  it('runs an authorized handler, renews its lease and commits completion', async () => {
    const handler = vi.fn().mockImplementation(async ({ heartbeat }: { heartbeat: () => Promise<boolean> }) => {
      expect(await heartbeat()).toBe(true);
      return { result: 'ok' };
    });
    const unregister = registerStudioTaskHandler('studio.test', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', async () => ({ allowed: true }));
      expect(result).toMatchObject({ state: 'completed', taskId: 'task-1' });
      expect(mocks.directTaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1', status: 'running', leaseOwner: 'worker-1' }),
      }));
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', output: { result: 'ok' } }),
      }));
    } finally {
      unregister();
    }
  });

  it('does not report completion after the worker loses its lease', async () => {
    mocks.taskUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const handler = vi.fn().mockResolvedValue({ result: 'late' });
    const unregister = registerStudioTaskHandler('studio.test', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', async () => ({ allowed: true }));
      expect(result).toMatchObject({
        state: 'failed',
        taskId: 'task-1',
        error: 'Studio worker lease expired before completion could be committed.',
      });
      expect(mocks.eventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.completed' }),
      }));
    } finally {
      unregister();
    }
  });

  it('records lease recovery only for rows this process successfully transitions', async () => {
    mocks.taskFindMany.mockResolvedValue([
      { id: 'task-a', projectId: 'project-1', ownerUserId: 'owner-1', attempts: 1, maxAttempts: 3 },
      { id: 'task-b', projectId: 'project-1', ownerUserId: 'owner-1', attempts: 3, maxAttempts: 3 },
    ]);
    mocks.taskUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await recoverExpiredStudioLeases();

    expect(result).toEqual({ inspected: 2, recovered: 1, failed: 0 });
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'task.lease_recovered', taskId: 'task-a' }),
    }));
  });
});
