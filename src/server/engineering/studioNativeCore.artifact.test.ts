import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  projectFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  artifactCreate: vi.fn(),
  eventCreate: vi.fn(),
  artifactFindUnique: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: { $transaction: mocks.transaction, studioProject: { findFirst: mocks.projectFindFirst } },
}));

import { createStudioArtifact } from './studioNativeCore.js';

describe('Studio task artifact lease fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx = {
      $queryRaw: mocks.queryRaw,
      studioProject: { findFirst: mocks.projectFindFirst },
      studioTask: { findFirst: mocks.taskFindFirst },
      studioArtifact: { create: mocks.artifactCreate, findUnique: mocks.artifactFindUnique },
      studioEvent: { create: mocks.eventCreate },
    };
    mocks.transaction.mockImplementation(async (callback: (tx: typeof tx) => unknown) => callback(tx));
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-1' });
    mocks.taskFindFirst.mockResolvedValue({ id: 'task-1' });
    mocks.queryRaw.mockResolvedValue([{ id: 'task-1' }]);
    mocks.artifactCreate.mockResolvedValue({ id: 'artifact-1', projectId: 'project-1', taskId: 'task-1', ownerUserId: 'owner-1', title: 'CI evidence report', kind: 'report', storageProvider: 'supabase', storageKey: 'private/owner-1/report.json', mimeType: null, byteSize: null, sha256: null });
    mocks.artifactFindUnique.mockResolvedValue(null);
    mocks.eventCreate.mockResolvedValue({});
  });

  const baseInput = {
    projectId: 'project-1',
    taskId: 'task-1',
    ownerUserId: 'owner-1',
    title: 'CI evidence report',
    kind: 'report',
    storageProvider: 'supabase',
    storageKey: 'private/owner-1/report.json',
    idempotencyKey: 'studio-task:task-1:report:v1',
    leaseFence: { workerId: 'worker-1', claimToken: '11111111-1111-4111-8111-111111111111' },
  };

  it('rejects an expired or replaced worker lease before artifact or event writes', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(createStudioArtifact(baseInput)).rejects.toThrow(
      'Studio task lease is no longer active; artifact registration was rejected.',
    );
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('requires a lease for task-bound artifact registration', async () => {
    const { leaseFence, ...withoutLease } = baseInput;
    void leaseFence;
    await expect(createStudioArtifact(withoutLease)).rejects.toThrow(
      'Task-bound artifact registration requires the active worker lease.',
    );
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('returns an identical previously registered artifact without duplicating its event', async () => {
    const existing = { id: 'artifact-existing', projectId: 'project-1', taskId: 'task-1', ownerUserId: 'owner-1', title: 'CI evidence report', kind: 'report', storageProvider: 'supabase', storageKey: 'private/owner-1/report.json', mimeType: null, byteSize: null, sha256: null };
    mocks.artifactFindUnique.mockResolvedValue(existing);
    const result = await createStudioArtifact(baseInput);
    expect(result).toEqual(existing);
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for different content', async () => {
    mocks.artifactFindUnique.mockResolvedValue({ ...baseInput, id: 'artifact-existing', storageKey: 'other/key' });
    await expect(createStudioArtifact(baseInput)).rejects.toThrow(
      'Studio artifact idempotency key was reused with different artifact content or scope.',
    );
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('registers artifact and lifecycle event in the same active-lease transaction', async () => {
    const result = await createStudioArtifact(baseInput);
    expect(result).toMatchObject({ id: 'artifact-1' });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const [sql, taskId, projectId, ownerUserId, workerId, claimToken] = mocks.queryRaw.mock.calls[0];
    expect(sql.join('')).toContain('FOR UPDATE');
    expect([taskId, projectId, ownerUserId, workerId, claimToken]).toEqual([
      'task-1', 'project-1', 'owner-1', 'worker-1', baseInput.leaseFence.claimToken,
    ]);
    expect(mocks.artifactCreate).toHaveBeenCalledOnce();
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'artifact.registered', taskId: 'task-1' }),
    }));
  });
});
