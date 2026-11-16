import type { StudioTask } from '@prisma/client';
import { evaluateGenXSecurityEvent, type GenXPolicyResult } from '../../security/genxPolicy.js';
import { prisma } from '../../lib/prisma.js';

export interface StudioTaskPolicyDecision {
  allowed: boolean;
  decision: GenXPolicyResult['decision'];
  ruleId: string;
  reason: string;
  approvalReference?: string;
}

/**
 * Adapt Studio task execution to the canonical deterministic Gen-X policy.
 * Unknown Studio tools intentionally receive REQUIRE_APPROVAL from Gen-X.
 * A recorded owner approval satisfies that requirement; it never overrides DENY.
 */
export async function authorizeStudioTaskWithGenX(
  task: StudioTask,
  workerId: string,
): Promise<StudioTaskPolicyDecision> {
  const policy = evaluateGenXSecurityEvent({
    agentId: workerId,
    principal: task.ownerUserId,
    toolName: 'studio_native_task:' + task.taskType,
    action: 'CREATE',
    target: 'studio-project:' + task.projectId + '/task:' + task.id,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    actorType: 'agent',
  });

  if (policy.decision === 'DENY') {
    return { allowed: false, decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason };
  }

  if (policy.decision === 'REQUIRE_APPROVAL') {
    const approval = await prisma.studioEvent.findFirst({
      where: { taskId: task.id, ownerUserId: task.ownerUserId, eventType: 'task.human_approved' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!approval || task.approvalStatus !== 'approved' || !task.approvalRequired) {
      return { allowed: false, decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason };
    }
    return {
      allowed: true,
      decision: policy.decision,
      ruleId: policy.ruleId,
      reason: 'Gen-X requires approval; a matching owner approval is recorded.',
      approvalReference: approval.id,
    };
  }

  return { allowed: true, decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason };
}
