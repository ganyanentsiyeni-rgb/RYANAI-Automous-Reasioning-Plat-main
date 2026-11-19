import type { StudioTask } from '@prisma/client';
import { RYANAI_WORKER_ROSTER } from '../../agent/workerRegistry.js';

export interface StudioTaskAdmissionDecision {
  allowed: boolean;
  decision: 'ALLOW' | 'DENY';
  ruleId: string;
  reason: string;
}

/**
 * RyanAI-native task admission.
 *
 * This checks whether a persisted task is eligible for a registered,
 * server-owned handler. It is not a general-purpose tool authorization grant.
 * Every handler must still enforce its own capability boundary before side
 * effects. Unknown workers, task types and requested capabilities fail closed.
 */
export function evaluateRyanAIStudioTaskAdmission(task: Pick<
  StudioTask,
  'taskType' | 'assignedWorkerId' | 'requiredCapabilities' | 'approvalRequired' | 'approvalStatus'
>): StudioTaskAdmissionDecision {
  const workerId = task.assignedWorkerId?.trim();
  if (!workerId) {
    return { allowed: false, decision: 'DENY', ruleId: 'RYANAI-TASK-001', reason: 'Task has no registered RyanAI worker assignment.' };
  }

  const worker = RYANAI_WORKER_ROSTER.find((candidate) => candidate.id === workerId);
  if (!worker) {
    return { allowed: false, decision: 'DENY', ruleId: 'RYANAI-TASK-002', reason: 'Assigned worker is not registered in the RyanAI workforce.' };
  }

  if (!worker.taskTypes.includes(task.taskType)) {
    return { allowed: false, decision: 'DENY', ruleId: 'RYANAI-TASK-003', reason: 'Assigned worker does not support this task type.' };
  }

  const granted = new Set(worker.allowedActions);
  const requested = task.requiredCapabilities ?? [];
  const unsupported = requested.filter((capability) => !granted.has(capability));
  if (unsupported.length > 0) {
    return {
      allowed: false,
      decision: 'DENY',
      ruleId: 'RYANAI-TASK-004',
      reason: 'Task requests capabilities not declared by its assigned worker: ' + unsupported.join(', '),
    };
  }

  if (task.approvalRequired && task.approvalStatus !== 'approved') {
    return { allowed: false, decision: 'DENY', ruleId: 'RYANAI-TASK-005', reason: 'This task requires an explicit, persisted owner approval.' };
  }

  return {
    allowed: true,
    decision: 'ALLOW',
    ruleId: 'RYANAI-TASK-ALLOW-001',
    reason: 'Registered RyanAI worker, task type, capability declarations and approval state are valid.',
  };
}
