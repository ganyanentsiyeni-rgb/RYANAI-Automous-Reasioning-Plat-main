import { describe, expect, it } from 'vitest';
import { buildUserAwarenessSnapshot, toOperationalTask } from './operationalAwarenessService';

const base = {
  id: 'run-1', objective: 'Check queue health', status: 'running',
  createdAt: '2026-11-07T20:00:00.000Z', updatedAt: '2026-11-07T20:01:00.000Z',
  handoffs: [{ status: 'completed' }, { status: 'running' }],
};

describe('operational awareness service mapping', () => {
  it('maps persisted handoff evidence to measurable progress', () => {
    expect(toOperationalTask(base).progress).toEqual({ completed: 1, total: 2 });
  });

  it('does not treat a terminal database status as verified completion', () => {
    const task = toOperationalTask({ ...base, status: 'completed' });
    expect(task.completionVerified).toBe(false);
  });

  it('preserves failures and cancellation as distinct task states', () => {
    expect(toOperationalTask({ ...base, status: 'failed', error: 'Provider unavailable' }).state).toBe('failed');
    expect(toOperationalTask({ ...base, status: 'cancelled' }).state).toBe('cancelled');
  });

  it('returns worker listener and recovery telemetry without exposing private run payloads', () => {
    const snapshot = buildUserAwarenessSnapshot([base], {
      state: 'running', listener: { state: 'listening', connected: true, subscribed: true },
      recoveryIntervalMs: 30000, lastRecoverySweepAt: '2026-11-07T20:01:00.000Z',
    }, 'online', '2026-11-07T20:01:01.000Z');
    expect(snapshot.worker).toMatchObject({ state: 'running', listenerConnected: true, listenerSubscribed: true });
    expect(snapshot.report).toMatchObject({ total: 1, executing: 1 });
    expect(snapshot.tasks[0]).not.toHaveProperty('objective');
  });
});
