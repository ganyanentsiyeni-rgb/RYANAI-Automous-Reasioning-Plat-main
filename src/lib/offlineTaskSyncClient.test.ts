import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_TASK_OUTBOX_DB,
  enqueueOfflineTask,
  listOfflineTasks,
} from './offlineTaskOutbox';
import { replayOfflineTaskBatch } from './offlineTaskSyncClient';

const firstId = '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101';
const secondId = '9c6e3a1b-4f53-4d0b-9b82-2b0f0a66c202';

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

describe('offline task reconnect and recovery', () => {
  it('retains every local task when the API is unavailable, then replays with stable IDs', async () => {
    const first = await enqueueOfflineTask('user-a', 'Continue the report', firstId);
    const second = await enqueueOfflineTask('user-a', 'Prepare the next briefing', secondId);
    const unavailable = await replayOfflineTaskBatch('user-a', [first, second], async () => {
      throw new Error('Network unavailable');
    });
    expect(unavailable.acceptedIds).toEqual([]);
    expect(unavailable.rejectedIds).toEqual([firstId, secondId]);
    expect(await listOfflineTasks('user-a')).toMatchObject([
      { taskId: firstId, attempts: 1, lastError: 'Network unavailable' },
      { taskId: secondId, attempts: 1, lastError: 'Network unavailable' },
    ]);

    const reconnected = await replayOfflineTaskBatch('user-a', await listOfflineTasks('user-a'), async (tasks) => ({
      results: tasks.map((task) => ({ taskId: task.taskId, accepted: true, status: 'queued' })),
    }));
    expect(reconnected.acceptedIds).toEqual([firstId, secondId]);
    expect(await listOfflineTasks('user-a')).toEqual([]);
  });

  it('removes only explicitly accepted IDs after a partial server response', async () => {
    const first = await enqueueOfflineTask('user-a', 'Continue the report', firstId);
    const second = await enqueueOfflineTask('user-a', 'Prepare the next briefing', secondId);
    const outcome = await replayOfflineTaskBatch('user-a', [first, second], async () => ({
      results: [
        { taskId: firstId, accepted: true, status: 'queued' },
        { taskId: secondId, accepted: false, status: 'rejected' },
      ],
    }));
    expect(outcome.acceptedIds).toEqual([firstId]);
    expect(outcome.rejectedIds).toEqual([secondId]);
    expect(await listOfflineTasks('user-a')).toMatchObject([
      { taskId: secondId, attempts: 1 },
    ]);
  });

  it('does not clear tasks when a response omits their stable IDs', async () => {
    const first = await enqueueOfflineTask('user-a', 'Continue the report', firstId);
    const outcome = await replayOfflineTaskBatch('user-a', [first], async () => ({
      results: [{ taskId: secondId, accepted: true, status: 'queued' }],
    }));
    expect(outcome.acceptedIds).toEqual([]);
    expect(await listOfflineTasks('user-a')).toMatchObject([{ taskId: firstId, attempts: 1 }]);
  });

  it('keeps retrying the same ID safely after an ambiguous response', async () => {
    const first = await enqueueOfflineTask('user-a', 'Continue the report', firstId);
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Connection dropped after request'))
      .mockResolvedValueOnce({ results: [{ taskId: firstId, accepted: true, status: 'queued' }] });
    const firstAttempt = await replayOfflineTaskBatch('user-a', [first], send);
    expect(firstAttempt.acceptedIds).toEqual([]);
    const secondAttempt = await replayOfflineTaskBatch('user-a', await listOfflineTasks('user-a'), send);
    expect(send).toHaveBeenNthCalledWith(2, [{ taskId: firstId, objective: 'Continue the report' }]);
    expect(secondAttempt.acceptedIds).toEqual([firstId]);
    expect(await listOfflineTasks('user-a')).toEqual([]);
  });
});
