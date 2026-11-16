import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  OFFLINE_TASK_OUTBOX_DB,
  enqueueOfflineTask,
  listOfflineTasks,
  recordOfflineTaskFailure,
  removeAcceptedOfflineTasks,
} from './offlineTaskOutbox';

const taskId = '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101';

function deleteOutbox() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OFFLINE_TASK_OUTBOX_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Outbox database remained open during test cleanup.'));
  });
}

beforeEach(async () => {
  await deleteOutbox();
});

describe('IndexedDB offline task outbox', () => {
  it('durably stores a normalized task and scopes reads to its owner', async () => {
    const saved = await enqueueOfflineTask('user-a', '  Continue the report  ', taskId);
    expect(saved).toMatchObject({ taskId, ownerId: 'user-a', objective: 'Continue the report', attempts: 0 });
    expect(await listOfflineTasks('user-a')).toHaveLength(1);
    expect(await listOfflineTasks('user-b')).toEqual([]);
  });

  it('treats the same owner and objective as an idempotent local enqueue', async () => {
    const first = await enqueueOfflineTask('user-a', 'Continue the report', taskId);
    const replay = await enqueueOfflineTask('user-a', 'Continue the report', taskId);
    expect(replay.createdAt).toBe(first.createdAt);
    expect(await listOfflineTasks('user-a')).toHaveLength(1);
  });

  it('rejects task ID reuse across owners or changed objectives', async () => {
    await enqueueOfflineTask('user-a', 'Continue the report', taskId);
    await expect(enqueueOfflineTask('user-b', 'Continue the report', taskId)).rejects.toThrow(/different owner/i);
    await expect(enqueueOfflineTask('user-a', 'Prepare a new report', taskId)).rejects.toThrow(/different owner or objective/i);
  });

  it('retains retry metadata until server acceptance and removes only for the matching owner', async () => {
    await enqueueOfflineTask('user-a', 'Continue the report', taskId);
    await recordOfflineTaskFailure('user-a', taskId, 'API temporarily unavailable');
    expect(await listOfflineTasks('user-a')).toMatchObject([
      { taskId, attempts: 1, lastError: 'API temporarily unavailable' },
    ]);
    await removeAcceptedOfflineTasks('user-b', [taskId]);
    expect(await listOfflineTasks('user-a')).toHaveLength(1);
    await removeAcceptedOfflineTasks('user-a', [taskId]);
    expect(await listOfflineTasks('user-a')).toEqual([]);
  });

  it('rejects invalid owner and objective data before persistence', async () => {
    await expect(enqueueOfflineTask('', 'Continue the report', taskId)).rejects.toThrow(/sign in/i);
    await expect(enqueueOfflineTask('user-a', 'no', taskId)).rejects.toThrow(/5 to 20000/i);
    expect(await listOfflineTasks('user-a')).toEqual([]);
  });
});
