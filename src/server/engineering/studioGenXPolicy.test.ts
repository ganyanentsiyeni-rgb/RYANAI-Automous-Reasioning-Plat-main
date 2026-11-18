import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioTask } from '@prisma/client';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { studioEvent: { findFirst: mocks.findFirst } },
}));

import { authorizeStudioTaskWithGenX } from './studioGenXPolicy.js';

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
    input: {},
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

describe('Studio Gen-X policy adapter', () => {
  beforeEach(() => mocks.findFirst.mockReset());

  it('does not execute a Studio task while Gen-X approval is missing', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await authorizeStudioTaskWithGenX(task({ approvalStatus: 'blocked' }), 'studio-worker-test');
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
    expect(result.ruleId).toBe('GX-HIL-001');
  });

  it('satisfies REQUIRE_APPROVAL only with an owner approval event', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'approval-event-123' });
    const result = await authorizeStudioTaskWithGenX(task(), 'studio-worker-test');
    expect(result).toMatchObject({
      allowed: true,
      decision: 'REQUIRE_APPROVAL',
      ruleId: 'GX-HIL-001',
      approvalReference: 'approval-event-123',
    });
  });

  it('never lets an owner approval override a Gen-X DENY', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'approval-event-123' });
    const result = await authorizeStudioTaskWithGenX(task({ projectId: 'private-key-project' }), 'studio-worker-test');
    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('DENY');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
