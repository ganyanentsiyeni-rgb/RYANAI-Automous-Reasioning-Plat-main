import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    studioProject: { findFirst: vi.fn() },
    studioTask: { findMany: vi.fn(), updateMany: vi.fn() },
    studioEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));

import { createStudioArtifact, heartbeatStudioTask, recoverExpiredStudioLeases } from './studioNativeCore.js';

describe('Studio worker lease fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires the exact claim token for a heartbeat', async () => {
    prismaMock.studioTask.updateMany.mockResolvedValue({ count: 0 });

    const alive = await heartbeatStudioTask('task-1', 'worker-1', '11111111-1111-4111-8111-111111111111');

    expect(alive).toBe(false);
    expect(prismaMock.studioTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-1',
        status: 'running',
        leaseOwner: 'worker-1',
        leaseToken: '11111111-1111-4111-8111-111111111111',
        leaseExpiresAt: expect.objectContaining({ gt: expect.any(Date) }),
      }),
    }));
  });

  it('records recovery only for the process that wins the conditional lease update', async () => {
    const tx = {
      studioTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'task-1', projectId: 'project-1', ownerUserId: 'owner-1', attempts: 1, maxAttempts: 3 },
          { id: 'task-2', projectId: 'project-1', ownerUserId: 'owner-1', attempts: 2, maxAttempts: 3 },
        ]),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      studioEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await recoverExpiredStudioLeases();

    expect(result).toEqual({ inspected: 2, recovered: 1, failed: 0 });
    expect(tx.studioTask.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.studioTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-1',
        status: 'running',
        leaseExpiresAt: expect.objectContaining({ lte: expect.any(Date) }),
      }),
      data: expect.objectContaining({ status: 'queued', leaseOwner: null, leaseToken: null }),
    }));
    expect(tx.studioEvent.create).toHaveBeenCalledOnce();
    expect(tx.studioEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ taskId: 'task-1', eventType: 'task.lease_recovered' }),
    }));
  });

  it('marks exhausted attempts failed and clears the expired lease token', async () => {
    const tx = {
      studioTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'task-exhausted', projectId: 'project-1', ownerUserId: 'owner-1', attempts: 3, maxAttempts: 3 },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      studioEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await recoverExpiredStudioLeases();

    expect(result).toEqual({ inspected: 1, recovered: 0, failed: 1 });
    expect(tx.studioTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-exhausted', status: 'running' }),
      data: expect.objectContaining({ status: 'failed', leaseOwner: null, leaseToken: null, completedAt: expect.any(Date) }),
    }));
    expect(tx.studioEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ taskId: 'task-exhausted', eventType: 'task.lease_exhausted' }),
    }));
  });

  it('locks and verifies the active lease before registering a task artifact', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
      studioArtifact: { create: vi.fn().mockResolvedValue({ id: 'artifact-1', kind: 'plan', sha256: 'abc' }) },
      studioEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    prismaMock.studioProject.findFirst.mockResolvedValue({ id: 'project-1' });
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const artifact = await createStudioArtifact({
      projectId: 'project-1',
      taskId: 'task-1',
      ownerUserId: 'owner-1',
      title: 'Plan',
      kind: 'plan',
      storageProvider: 'supabase-storage',
      storageKey: 'owner/project/task/object.json',
      leaseFence: { workerId: 'worker-1', claimToken: '11111111-1111-4111-8111-111111111111' },
    });

    expect(artifact.id).toBe('artifact-1');
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.studioArtifact.create).toHaveBeenCalledOnce();
    expect(tx.studioEvent.create).toHaveBeenCalledOnce();
  });

  it('rejects stale artifact registration and does not create metadata', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      studioArtifact: { create: vi.fn() },
      studioEvent: { create: vi.fn() },
    };
    prismaMock.studioProject.findFirst.mockResolvedValue({ id: 'project-1' });
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(createStudioArtifact({
      projectId: 'project-1',
      taskId: 'task-1',
      ownerUserId: 'owner-1',
      title: 'Stale plan',
      kind: 'plan',
      storageProvider: 'supabase-storage',
      storageKey: 'owner/project/task/stale.json',
      leaseFence: { workerId: 'worker-1', claimToken: '11111111-1111-4111-8111-111111111111' },
    })).rejects.toThrow('Studio worker lease expired before artifact registration.');

    expect(tx.studioArtifact.create).not.toHaveBeenCalled();
    expect(tx.studioEvent.create).not.toHaveBeenCalled();
  });
});
