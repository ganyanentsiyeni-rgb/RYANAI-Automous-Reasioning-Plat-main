import { describe, expect, it } from 'vitest';
import { normalizeOfflineTaskBatch } from './offlineTaskSync';

const taskId = '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101';

describe('offline task sync batch validation', () => {
  it('normalizes task objectives while preserving stable client task IDs', () => {
    expect(normalizeOfflineTaskBatch([{ taskId, objective: '  Resume my report  ' }])).toEqual([
      { taskId, objective: 'Resume my report' },
    ]);
  });

  it('rejects duplicate task IDs within a batch', () => {
    expect(() => normalizeOfflineTaskBatch([
      { taskId, objective: 'Resume my report' },
      { taskId, objective: 'Resume my report' },
    ])).toThrow(/duplicate taskId/i);
  });

  it('rejects UUID duplicates even when casing differs', () => {
    expect(() => normalizeOfflineTaskBatch([
      { taskId, objective: 'Resume my report' },
      { taskId: taskId.toUpperCase(), objective: 'Resume my report' },
    ])).toThrow(/duplicate taskId/i);
  });

  it('rejects malformed IDs and empty or oversized batches', () => {
    expect(() => normalizeOfflineTaskBatch([{ taskId: 'not-a-uuid', objective: 'Resume my report' }])).toThrow(/stable taskId/i);
    expect(() => normalizeOfflineTaskBatch([])).toThrow(/between 1 and 20/i);
    expect(() => normalizeOfflineTaskBatch(Array.from({ length: 21 }, (_, i) => ({
      taskId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b' + String(i).padStart(2, '0'),
      objective: 'Task number ' + i,
    })))).toThrow(/between 1 and 20/i);
  });

  it('rejects invalid objective content before persistence', () => {
    expect(() => normalizeOfflineTaskBatch([{ taskId, objective: '  ' }])).toThrow(/5 to 20000/i);
    expect(() => normalizeOfflineTaskBatch([{ taskId, objective: 42 }])).toThrow(/requires an objective/i);
  });
});
