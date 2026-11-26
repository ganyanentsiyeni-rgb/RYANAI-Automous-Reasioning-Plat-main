import { describe, expect, it } from 'vitest';
import { buildUserAwarenessSnapshot, toOperationalTask } from './operationalAwarenessService';

const base = {
  id: 'run-1', objective: 'Check queue health', status: 'running', approvalStatus: 'approved',
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

  it('surfaces pending approval and never reports it as granted', () => {
    const task = toOperationalTask({ ...base, status: 'queued', approvalStatus: 'pending' });
    expect(task).toMatchObject({ state: 'awaiting_approval', approvalRequired: true, approvalGranted: false });
    expect(task).toHaveProperty('indicator');
  });

  it('marks an expired running lease as retrying and exposes lease ownership and timestamps', () => {
    const task = toOperationalTask({
      ...base,
      leaseExpiresAt: '2026-11-07T20:02:00.000Z',
      lockedAt: '2026-11-07T20:00:30.000Z',
      heartbeatAt: '2026-11-07T20:01:00.000Z',
      workerId: 'worker-a',
      attempts: 2,
      maxAttempts: 4,
    }, new Date('2026-11-07T20:03:00.000Z'));
    expect(task.state).toBe('retrying');
    expect(task.lease).toMatchObject({ state: 'expired', workerId: 'worker-a', attempts: 2, maxAttempts: 4 });
  });

  it('reports recovered tasks from append-only execution evidence', () => {
    const task = toOperationalTask({
      ...base,
      attempts: 3,
      evidence: [
        { eventType: 'execution.started', createdAt: '2026-11-07T20:00:00.000Z' },
        { eventType: 'execution.recovered', createdAt: '2026-11-07T20:02:00.000Z' },
        { eventType: 'execution.recovered', createdAt: '2026-11-07T20:03:00.000Z' },
      ],
    });
    expect(task.recovery).toEqual({
      recovered: true, recoveryCount: 2, lastRecoveredAt: '2026-11-07T20:03:00.000Z',
    });
  });

  it('returns worker listener and recovery telemetry without exposing private run payloads', () => {
    const snapshot = buildUserAwarenessSnapshot([base], {
      state: 'running', listener: { state: 'listening', connected: true, subscribed: true },
      recoveryIntervalMs: 30000, lastRecoverySweepAt: '2026-11-07T20:01:00.000Z',
    }, 'online', '2026-11-07T20:01:01.000Z');
    expect(snapshot.worker).toMatchObject({ state: 'running', listenerConnected: true, listenerSubscribed: true });
    expect(snapshot.report).toMatchObject({ total: 1, executing: 1 });
    expect(snapshot.tasks[0]).not.toHaveProperty('objective');
    expect(snapshot.tasks[0]).toHaveProperty('lease');
    expect(snapshot.tasks[0]).toHaveProperty('recovery');
  });
});
