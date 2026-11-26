import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioTask } from '@prisma/client';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { studioEvent: { findFirst: mocks.findFirst } },
}));

import { authorizeStudioTaskWithGenX } from './studioGenXPolicy.js';
import { studioTaskApprovalDigest, STUDIO_TASK_APPROVAL_DIGEST_VERSION } from './studioTaskApprovalDigest.js';

function task(overrides: Partial<StudioTask> = {}): StudioTask {
  return {
    id: 'task-123',
    projectId: 'project-123',
    ownerUserId: 'owner-123',
    title: 'Create plan',
    objective: 'Prepare a bounded project plan.',
    taskType: 'studio.plan',
    status: 'queued',
    priority: 1,
    requiredCapabilities: ['planning'],
    assignedWorkerId: null,
    dependsOnIds: [],
    input: { plan: { z: 2, a: 1 } },
    output: null,
    attempts: 0,
    maxAttempts: 3,
    availableAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    approvalRequired: true,
    approvalStatus: 'approved',
    idempotencyKey: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StudioTask;
}

function approvalFor(value: StudioTask) {
  return {
    id: 'approval-event-123',
    payload: {
      scope: 'single_task',
      approvalSource: 'authenticated_owner_api',
      taskContentDigestVersion: STUDIO_TASK_APPROVAL_DIGEST_VERSION,
      taskContentSha256: studioTaskApprovalDigest(value),
    },
  };
}

describe('Studio Gen-X policy adapter', () => {
  beforeEach(() => mocks.findFirst.mockReset());

  it('does not execute a Studio task while Gen-X approval is missing', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await authorizeStudioTaskWithGenX(task({ approvalStatus: 'blocked' }), 'studio-worker-test');
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.ruleId).toBe('GX-HIL-001');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('satisfies REQUIRE_APPROVAL only with an owner approval bound to the exact task digest', async () => {
    const currentTask = task();
    mocks.findFirst.mockResolvedValue(approvalFor(currentTask));
    const result = await authorizeStudioTaskWithGenX(currentTask, 'studio-worker-test');
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: 'task-123', ownerUserId: 'owner-123', actorId: 'owner-123', eventType: 'task.human_approved' },
      select: { id: true, payload: true },
    }));
    expect(result).toMatchObject({
      allowed: true,
      decision: 'REQUIRE_APPROVAL',
      ruleId: 'GX-HIL-001',
      approvalReference: 'approval-event-123',
    });
  });

  it.each([
    ['title', { title: 'Changed title' }],
    ['objective', { objective: 'Changed objective' }],
    ['task type', { taskType: 'studio.deploy' }],
    ['priority', { priority: 9 }],
    ['capabilities', { requiredCapabilities: ['planning', 'network.write'] }],
    ['assigned worker', { assignedWorkerId: 'different-worker' }],
    ['dependencies', { dependsOnIds: ['dependency-2'] }],
    ['input', { input: { plan: { a: 1, z: 3 } } }],
  ])('rejects stale owner approval when %s changes', async (_field, changes) => {
    const approvedTask = task();
    mocks.findFirst.mockResolvedValue(approvalFor(approvedTask));
    const result = await authorizeStudioTaskWithGenX(task(changes), 'studio-worker-test');
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
  });

  it('rejects legacy, malformed and unsupported-version approval payloads', async () => {
    for (const payload of [
      { scope: 'single_task' },
      { taskContentDigestVersion: STUDIO_TASK_APPROVAL_DIGEST_VERSION, taskContentSha256: 'not-a-digest' },
      { taskContentDigestVersion: 999, taskContentSha256: studioTaskApprovalDigest(task()) },
    ]) {
      mocks.findFirst.mockResolvedValue({ id: 'old-approval', payload });
      const result = await authorizeStudioTaskWithGenX(task(), 'studio-worker-test');
      expect(result.allowed).toBe(false);
    }
  });

  it('never lets an owner approval override a Gen-X DENY', async () => {
    mocks.findFirst.mockResolvedValue(approvalFor(task()));
    const result = await authorizeStudioTaskWithGenX(task({ projectId: 'private-key-project' }), 'studio-worker-test');
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('DENY');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
