import { prisma } from '../../lib/prisma.js';
import { studioTaskApprovalDigest, STUDIO_TASK_APPROVAL_DIGEST_VERSION } from './studioTaskApprovalDigest.js';

/** Owner-authenticated approval for one immutable Studio task content revision. */
export async function approveStudioTask(taskId: string, ownerUserId: string, actorId: string) {
  if (!taskId || !ownerUserId || actorId !== ownerUserId) throw new Error('A verified project owner is required to approve this task.');
  return prisma.$transaction(async (tx) => {
    const task = await tx.studioTask.findFirst({
      where: { id: taskId, ownerUserId },
      select: {
        id: true, projectId: true, status: true, approvalStatus: true, ownerUserId: true,
        title: true, objective: true, taskType: true, priority: true,
        requiredCapabilities: true, assignedWorkerId: true, dependsOnIds: true, input: true,
      },
    });
    if (!task) throw new Error('Studio task not found for this owner.');
    if (!['queued', 'blocked'].includes(task.status)) throw new Error('Only queued or policy-blocked tasks can be approved.');
    if (task.approvalStatus === 'approved') return { taskId, state: 'already_approved' as const };

    const taskContentSha256 = studioTaskApprovalDigest(task);
    const updated = await tx.studioTask.updateMany({
      where: {
        id: task.id, ownerUserId, status: task.status,
        approvalStatus: task.approvalStatus,
      },
      data: { status: 'queued', approvalRequired: true, approvalStatus: 'approved', availableAt: new Date() },
    });
    if (updated.count !== 1) throw new Error('Studio task changed while approval was being recorded; reload and approve the current task revision.');

    const event = await tx.studioEvent.create({
      data: {
        projectId: task.projectId, taskId: task.id, ownerUserId,
        actorId, eventType: 'task.human_approved',
        payload: {
          scope: 'single_task',
          approvalSource: 'authenticated_owner_api',
          taskContentDigestVersion: STUDIO_TASK_APPROVAL_DIGEST_VERSION,
          taskContentSha256,
        },
      },
      select: { id: true },
    });
    return { taskId, state: 'approved' as const, approvalReference: event.id, taskContentSha256 };
  });
}
