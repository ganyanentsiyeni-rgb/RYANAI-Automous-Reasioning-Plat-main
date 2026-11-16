import {
  recordOfflineTaskFailure,
  removeAcceptedOfflineTasks,
  type OfflineTaskRecord,
} from './offlineTaskOutbox';

export interface OfflineTaskSyncReply {
  results?: Array<{ taskId: string; accepted: boolean; status?: string }>;
  error?: string;
  status?: string;
}

export interface OfflineTaskSyncOutcome {
  acceptedIds: string[];
  rejectedIds: string[];
  error: string | null;
}

/**
 * Replay one bounded batch. A task is deleted locally only after an explicit
 * per-task acceptance for the same stable ID; all other outcomes remain retryable.
 */
export async function replayOfflineTaskBatch(
  ownerId: string,
  batch: OfflineTaskRecord[],
  send: (tasks: Array<Pick<OfflineTaskRecord, 'taskId' | 'objective'>>) => Promise<OfflineTaskSyncReply>,
): Promise<OfflineTaskSyncOutcome> {
  const taskIds = new Set(batch.map((task) => task.taskId));
  try {
    const reply = await send(batch.map(({ taskId, objective }) => ({ taskId, objective })));
    if (!Array.isArray(reply.results)) {
      throw new Error(reply.error || 'The server did not return per-task sync results.');
    }
    const acceptedIds = [...new Set(reply.results
      .filter((item) => item.accepted === true && taskIds.has(item.taskId))
      .map((item) => item.taskId))];
    const accepted = new Set(acceptedIds);
    const rejectedIds = batch.filter((task) => !accepted.has(task.taskId)).map((task) => task.taskId);
    await removeAcceptedOfflineTasks(ownerId, acceptedIds);
    for (const task of batch) {
      if (!accepted.has(task.taskId)) {
        await recordOfflineTaskFailure(
          ownerId,
          task.taskId,
          reply.error || 'Server did not confirm acceptance. This task remains saved locally for safe retry.',
        );
      }
    }
    return { acceptedIds, rejectedIds, error: rejectedIds.length ? reply.error || 'Some tasks remain pending server acceptance.' : null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Network or authentication failure during sync.';
    for (const task of batch) await recordOfflineTaskFailure(ownerId, task.taskId, message);
    return { acceptedIds: [], rejectedIds: batch.map((task) => task.taskId), error: message };
  }
}
