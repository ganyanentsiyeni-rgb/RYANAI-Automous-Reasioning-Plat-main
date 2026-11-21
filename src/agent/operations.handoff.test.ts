import { describe, expect, it } from 'vitest';
import { buildRunHandoffUpdateWhere } from './handoffReconciliation.js';

describe('agent run handoff reconciliation', () => {
  const run = { id: 'run-1', worker_id: 'worker-1', attempts: 2 };

  it('updates primary and secondary handoffs created by either the supervisor or Jarvis', () => {
    expect(buildRunHandoffUpdateWhere(run, 'primary')).toMatchObject({
      runId: 'run-1',
      run: { is: { status: 'running', workerId: 'worker-1', attempts: 2, leaseExpiresAt: { gt: expect.any(Date) } } },
      fromAgent: { in: ['supervisor', 'jarvis'] },
      toAgent: 'primary',
    });
    expect(buildRunHandoffUpdateWhere(run, 'secondary').fromAgent).toEqual({ in: ['supervisor', 'jarvis'] });
  });

  it('keeps logic handoffs targeted to the two analysis inputs under the active lease', () => {
    expect(buildRunHandoffUpdateWhere(run, 'logic')).toMatchObject({
      runId: 'run-1',
      run: { is: { status: 'running', workerId: 'worker-1', attempts: 2, leaseExpiresAt: { gt: expect.any(Date) } } },
      toAgent: 'logic',
      status: { in: ['pending', 'running'] },
    });
  });
});
