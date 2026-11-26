import { describe, expect, it } from 'vitest';
import type { StudioTask } from '@prisma/client';
import { studioTaskApprovalDigest } from './studioTaskApprovalDigest.js';

const base = {
  id: 'task-1',
  projectId: 'project-1',
  ownerUserId: 'owner-1',
  title: 'Task',
  objective: 'Do work',
  taskType: 'studio.plan',
  priority: 1,
  requiredCapabilities: ['read'],
  assignedWorkerId: null,
  dependsOnIds: [],
  input: { nested: { z: 2, a: 1 } },
} as unknown as StudioTask;

describe('Studio task approval digest', () => {
  it('canonicalizes object key order', () => {
    const reordered = { ...base, input: { nested: { a: 1, z: 2 } } } as StudioTask;
    expect(studioTaskApprovalDigest(base)).toBe(studioTaskApprovalDigest(reordered));
  });

  it('changes when execution-relevant content changes', () => {
    expect(studioTaskApprovalDigest(base)).not.toBe(studioTaskApprovalDigest({ ...base, objective: 'Different work' }));
  });

  it('ignores runtime state that does not change the approved task content', () => {
    expect(studioTaskApprovalDigest(base)).toBe(studioTaskApprovalDigest({
      ...base, status: 'running', attempts: 2, output: { result: 'runtime' }, updatedAt: new Date(),
    }));
  });
});
