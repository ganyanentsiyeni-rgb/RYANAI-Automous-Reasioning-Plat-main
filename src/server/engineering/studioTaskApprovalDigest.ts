import { createHash } from 'node:crypto';
import type { StudioTask } from '@prisma/client';

export const STUDIO_TASK_APPROVAL_DIGEST_VERSION = 1 as const;

type ApprovalBoundTask = Pick<
  StudioTask,
  | 'id'
  | 'projectId'
  | 'ownerUserId'
  | 'title'
  | 'objective'
  | 'taskType'
  | 'priority'
  | 'requiredCapabilities'
  | 'assignedWorkerId'
  | 'dependsOnIds'
  | 'input'
>;

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Studio task approval content contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]);
    return Object.fromEntries(entries);
  }
  throw new Error('Studio task approval content is not canonical JSON.');
}

/**
 * Binds a single owner approval to the exact execution-relevant Studio task
 * content. Runtime state, lease fields, timestamps and task output are omitted.
 */
export function studioTaskApprovalDigest(task: ApprovalBoundTask): string {
  const content = {
    schemaVersion: STUDIO_TASK_APPROVAL_DIGEST_VERSION,
    task: {
      id: task.id,
      projectId: task.projectId,
      ownerUserId: task.ownerUserId,
      title: task.title,
      objective: task.objective,
      taskType: task.taskType,
      priority: task.priority,
      requiredCapabilities: task.requiredCapabilities,
      assignedWorkerId: task.assignedWorkerId,
      dependsOnIds: task.dependsOnIds,
      input: task.input,
    },
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(content))).digest('hex');
}
