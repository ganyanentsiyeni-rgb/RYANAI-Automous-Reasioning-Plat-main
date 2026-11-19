import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    studioProject: { findFirst: vi.fn() },
    studioTask: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));

import { createStudioArtifact, heartbeatStudioTask } from './studioNativeCore.js';

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
