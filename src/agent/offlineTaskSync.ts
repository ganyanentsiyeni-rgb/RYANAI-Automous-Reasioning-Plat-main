export interface OfflineTaskInput {
  taskId: string;
  objective: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate and normalize a reconnect batch before any task is persisted. */
export function normalizeOfflineTaskBatch(input: unknown): OfflineTaskInput[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) {
    throw new Error('Offline sync requires between 1 and 20 tasks.');
  }
  const seen = new Set<string>();
  return input.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Offline sync task ' + index + ' is invalid.');
    }
    const task = value as Record<string, unknown>;
    if (typeof task.taskId !== 'string' || !UUID_PATTERN.test(task.taskId)) {
      throw new Error('Offline sync task ' + index + ' requires a valid stable taskId.');
    }
    const taskId = task.taskId.toLowerCase();
    if (seen.has(taskId)) throw new Error('Offline sync batch contains a duplicate taskId.');
    seen.add(taskId);
    if (typeof task.objective !== 'string') throw new Error('Offline sync task ' + index + ' requires an objective.');
    const objective = task.objective.trim();
    if (objective.length < 5 || objective.length > 20_000) {
      throw new Error('Offline sync task ' + index + ' objective must contain 5 to 20000 characters.');
    }
    return { taskId, objective };
  });
}
