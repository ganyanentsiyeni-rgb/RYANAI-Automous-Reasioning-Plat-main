import { prisma } from '../../lib/prisma.js';

/** Owner-authenticated approval for a single native task. Approval is immutable evidence in the event ledger. */
export async function approveStudioTask(taskId: string, ownerUserId: string, actorId: string) {
  if (!taskId || !ownerUserId || actorId !== ownerUserId) throw new Error('A verified project owner is required to approve this task.');
  return prisma.$transaction(async (tx) => {
    const task = await tx.studioTask.findFirst({
      where: { id: taskId, ownerUserId },
      select: { id: true, projectId: true, status: true, approvalStatus: true, ownerUserId: true },
    });
    if (!task) throw new Error('Studio task not found for this owner.');
    if (!['queued', 'blocked'].includes(task.status)) throw new Error('Only queued or policy-blocked tasks can be approved.');
    if (task.approvalStatus === 'approved') return { taskId, state: 'already_approved' as const };
    await tx.studioTask.update({
      where: { id: task.id },
      data: { status: 'queued', approvalRequired: true, approvalStatus: 'approved', availableAt: new Date() },
    });
    const event = await tx.studioEvent.create({
      data: {
        projectId: task.projectId, taskId: task.id, ownerUserId,
        actorId, eventType: 'task.human_approved',
        payload: { scope: 'single_task', approvalSource: 'authenticated_owner_api' },
      },
      select: { id: true },
    });
    return { taskId, state: 'approved' as const, approvalReference: event.id };
  });
}
