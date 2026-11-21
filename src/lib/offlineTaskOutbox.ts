export interface OfflineTaskRecord {
  taskId: string;
  ownerId: string;
  objective: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export const OFFLINE_TASK_OUTBOX_DB = 'ryanai-offline-task-outbox';
const STORE_NAME = 'tasks';

function openOutbox(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser does not support durable offline task storage.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_TASK_OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'taskId' });
        store.createIndex('ownerId', 'ownerId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open offline task storage.'));
    request.onblocked = () => reject(new Error('Offline task storage is busy in another tab. Close other RyanAI tabs and retry.'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline task storage request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline task storage transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline task storage transaction failed.'));
  });
}

function closeAfter<T>(db: IDBDatabase, promise: Promise<T>): Promise<T> {
  return promise.finally(() => db.close());
}

function validateTask(ownerId: string, objective: string, taskId: string) {
  if (!ownerId.trim()) throw new Error('Sign in before saving an offline task.');
  if (!taskId.trim()) throw new Error('A stable task ID is required.');
  const normalized = objective.trim();
  if (normalized.length < 5 || normalized.length > 20000) {
    throw new Error('Task objective must contain 5 to 20000 characters.');
  }
  return normalized;
}

/** Persist a task intent before any network dispatch. Repeated writes are idempotent. */
export async function enqueueOfflineTask(
  ownerId: string,
  objective: string,
  taskId: string,
): Promise<OfflineTaskRecord> {
  const normalized = validateTask(ownerId, objective, taskId);
  const db = await openOutbox();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const existing = await requestValue(store.get(taskId)) as OfflineTaskRecord | undefined;
  let record: OfflineTaskRecord;
  if (existing) {
    if (existing.ownerId !== ownerId || existing.objective !== normalized) {
      transaction.abort();
      await done.catch(() => undefined);
      db.close();
      throw new Error('This task ID is already assigned to a different owner or objective.');
    }
    record = existing;
  } else {
    record = {
      taskId,
      ownerId,
      objective: normalized,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    };
    store.add(record);
  }
  await closeAfter(db, done);
  return record;
}

export async function listOfflineTasks(ownerId: string): Promise<OfflineTaskRecord[]> {
  if (!ownerId.trim()) return [];
  const db = await openOutbox();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(transaction);
  const records = await requestValue(transaction.objectStore(STORE_NAME).getAll()) as OfflineTaskRecord[];
  await closeAfter(db, done);
  return records
    .filter((record) => record.ownerId === ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Remove only tasks accepted by the server and still owned by this account. */
export async function removeAcceptedOfflineTasks(ownerId: string, taskIds: string[]): Promise<void> {
  if (!taskIds.length) return;
  const db = await openOutbox();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  for (const taskId of taskIds) {
    const record = await requestValue(store.get(taskId)) as OfflineTaskRecord | undefined;
    if (record?.ownerId === ownerId) store.delete(taskId);
  }
  await closeAfter(db, done);
}

export async function recordOfflineTaskFailure(
  ownerId: string,
  taskId: string,
  message: string,
): Promise<void> {
  const db = await openOutbox();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const record = await requestValue(store.get(taskId)) as OfflineTaskRecord | undefined;
  if (record?.ownerId === ownerId) {
    store.put({ ...record, attempts: record.attempts + 1, lastError: message.slice(0, 500) });
  }
  await closeAfter(db, done);
}
