import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdateMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { approveStudioTask } from './studioApprovals.js';
import { studioTaskApprovalDigest, STUDIO_TASK_APPROVAL_DIGEST_VERSION } from './studioTaskApprovalDigest.js';

const task = {
  id: 'task-1',
  projectId: 'project-1',
  ownerUserId: 'owner-1',
  status: 'blocked',
  approvalStatus: 'blocked',
  title: 'Review release',
  objective: 'Inspect exact candidate evidence.',
  taskType: 'studio.review',
  priority: 2,
  requiredCapabilities: ['read-workflow-runs'],
  assignedWorkerId: 'release-reviewer',
  dependsOnIds: ['task-parent'],
  input: { headSha: 'a'.repeat(40) },
};

describe('Studio task owner approval', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      studioTask: { findFirst: mocks.taskFindFirst, updateMany: mocks.taskUpdateMany },
      studioEvent: { findFirst: mocks.eventFindFirst, create: mocks.eventCreate },
    }));
    mocks.taskFindFirst.mockResolvedValue(task);
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventFindFirst.mockResolvedValue(null);
    mocks.eventCreate.mockResolvedValue({ id: 'approval-1' });
  });

  it('records a versioned digest in the append-only owner approval event', async () => {
    const result = await approveStudioTask('task-1', 'owner-1', 'owner-1');
    const expectedDigest = studioTaskApprovalDigest(task as never);
    expect(result).toMatchObject({ state: 'approved', approvalReference: 'approval-1', taskContentSha256: expectedDigest });
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'task.human_approved',
        payload: {
          scope: 'single_task',
          approvalSource: 'authenticated_owner_api',
          taskContentDigestVersion: STUDIO_TASK_APPROVAL_DIGEST_VERSION,
          taskContentSha256: expectedDigest,
        },
      }),
    }));
  });

  it('fails closed if task state changes before the approval compare-and-set', async () => {
    mocks.taskUpdateMany.mockResolvedValue({ count: 0 });
    await expect(approveStudioTask('task-1', 'owner-1', 'owner-1')).rejects.toThrow(/changed while approval was being recorded/);
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it('allows an owner to refresh a legacy approval without a digest', async () => {
    mocks.taskFindFirst.mockResolvedValue({ ...task, status: 'queued', approvalStatus: 'approved' });
    mocks.eventFindFirst.mockResolvedValue({ id: 'legacy-approval', payload: { scope: 'single_task' } });
    const result = await approveStudioTask('task-1', 'owner-1', 'owner-1');
    expect(result).toMatchObject({ state: 'approved', approvalReference: 'approval-1' });
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects an actor other than the authenticated owner before reading the task', async () => {
    await expect(approveStudioTask('task-1', 'owner-1', 'agent-1')).rejects.toThrow(/verified project owner/);
    expect(mocks.taskFindFirst).not.toHaveBeenCalled();
  });
});
