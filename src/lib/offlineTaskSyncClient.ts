import {
  recordOfflineTaskFailure,
  removeAcceptedOfflineTasks,
  type OfflineTaskRecord,
} from './offlineTaskOutbox';

export interface OfflineTaskSyncReply {
  results?: Array<{ taskId: string; accepted: boolean; status?: string; createdAt?: string }>;
  error?: string;
  status?: string;
}

export interface OfflineTaskSyncOutcome {
  acceptedIds: string[];
  rejectedIds: string[];
  error: string | null;
}

type OfflineTaskSender = (tasks: Array<Pick<OfflineTaskRecord, 'taskId' | 'objective'>>) => Promise<OfflineTaskSyncReply>;

/**
 * Replay one bounded batch. A task is deleted locally only after an explicit
 * per-task acceptance for the same stable ID; all other outcomes remain retryable.
 */
export async function replayOfflineTaskBatch(
  ownerId: string,
  batch: OfflineTaskRecord[],
  send: OfflineTaskSender,
  reconcile?: OfflineTaskSender,
): Promise<OfflineTaskSyncOutcome> {
  const taskIds = new Set(batch.map((task) => task.taskId));
  try {
    const reply = await send(batch.map(({ taskId, objective }) => ({ taskId, objective })));
    if (!Array.isArray(reply.results)) {
      throw new Error(reply.error || 'The server did not return per-task sync results.');
    }
    const accepted = new Set(reply.results
      .filter((item) => item.accepted === true && taskIds.has(item.taskId))
      .map((item) => item.taskId));
    const resultById = new Map(reply.results.map((item) => [item.taskId, item]));
    const unresolved = batch.filter((task) => {
      if (accepted.has(task.taskId)) return false;
      const state = resultById.get(task.taskId)?.status;
      return state !== 'rejected' && state !== 'conflict';
    });
    let reconciliationError: string | null = null;
    if (reconcile && unresolved.length) {
      try {
        const reconciliationReply = await reconcile(unresolved.map(({ taskId, objective }) => ({ taskId, objective })));
        if (Array.isArray(reconciliationReply.results)) {
          for (const result of reconciliationReply.results) {
            if (!taskIds.has(result.taskId)) continue;
            resultById.set(result.taskId, result);
            if (result.accepted === true) accepted.add(result.taskId);
          }
        } else {
          reconciliationError = reconciliationReply.error || 'Exact-ID reconciliation returned no per-task results.';
        }
      } catch (cause) {
        reconciliationError = cause instanceof Error ? cause.message : 'Exact-ID reconciliation failed.';
      }
    }
    const acceptedIds = [...accepted];
    const rejectedIds = batch.filter((task) => !accepted.has(task.taskId)).map((task) => task.taskId);
    await removeAcceptedOfflineTasks(ownerId, acceptedIds);
    for (const task of batch) {
      if (!accepted.has(task.taskId)) {
        await recordOfflineTaskFailure(
          ownerId,
          task.taskId,
          reconciliationError || reply.error || 'Server did not confirm acceptance. This task remains saved locally for safe retry.',
          resultById.get(task.taskId)?.status === 'rejected' || resultById.get(task.taskId)?.status === 'conflict'
            ? 'rejected'
            : 'uncertain',
        );
      }
    }
    return { acceptedIds, rejectedIds, error: rejectedIds.length ? reconciliationError || reply.error || 'Some tasks remain pending server acceptance.' : null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Network or authentication failure during sync.';
    for (const task of batch) await recordOfflineTaskFailure(ownerId, task.taskId, message, 'uncertain');
    return { acceptedIds: [], rejectedIds: batch.map((task) => task.taskId), error: message };
  }
}
