import type { StudioTask } from '@prisma/client';
import { evaluateGenXSecurityEvent, type GenXPolicyResult } from '../../security/genxPolicy.js';
import { prisma } from '../../lib/prisma.js';
import { studioTaskApprovalDigest, STUDIO_TASK_APPROVAL_DIGEST_VERSION } from './studioTaskApprovalDigest.js';

export interface StudioTaskPolicyDecision {
  allowed: boolean;
  decision: GenXPolicyResult['decision'];
  ruleId: string;
  reason: string;
  approvalReference?: string;
}

/** Adapt Studio task execution to the canonical deterministic Gen-X policy. */
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
    if (task.approvalStatus !== 'approved' || !task.approvalRequired) {
      return { allowed: false, decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason };
    }
    const approval = await prisma.studioEvent.findFirst({
      where: { taskId: task.id, ownerUserId: task.ownerUserId, actorId: task.ownerUserId, eventType: 'task.human_approved' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    const payload = approval?.payload;
    const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const digestMatches = payloadRecord?.taskContentDigestVersion === STUDIO_TASK_APPROVAL_DIGEST_VERSION
      && typeof payloadRecord.taskContentSha256 === 'string'
      && /^[a-f0-9]{64}$/.test(payloadRecord.taskContentSha256)
      && payloadRecord.taskContentSha256 === studioTaskApprovalDigest(task);
    if (!approval || !digestMatches) {
      return {
        allowed: false,
        decision: policy.decision,
        ruleId: policy.ruleId,
        reason: 'Owner approval is missing, malformed, or bound to a different Studio task revision.',
      };
    }
    return {
      allowed: true,
      decision: policy.decision,
      ruleId: policy.ruleId,
      reason: 'Gen-X requires approval; an owner approval matching this exact task revision is recorded.',
      approvalReference: approval.id,
    };
  }

  return { allowed: true, decision: policy.decision, ruleId: policy.ruleId, reason: policy.reason };
}
