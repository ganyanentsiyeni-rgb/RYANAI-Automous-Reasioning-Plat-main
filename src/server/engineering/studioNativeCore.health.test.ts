import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  heartbeatFindMany: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    studioWorkerHeartbeat: { findMany: mocks.heartbeatFindMany },
  },
}));

import { classifyStudioWorkerLiveness, listStudioWorkerHealth } from './studioNativeCore.js';

describe('RyanAI Studio worker heartbeat health', () => {
  const now = Date.parse('2026-11-19T17:00:00.000Z');

  it('classifies recognized fresh and stale worker states', () => {
    expect(classifyStudioWorkerLiveness('healthy', new Date(now - 1_000), now)).toBe('healthy');
    expect(classifyStudioWorkerLiveness('starting', new Date(now - 1_000), now)).toBe('starting');
    expect(classifyStudioWorkerLiveness('degraded', new Date(now - 31_000), now)).toBe('stale');
    expect(classifyStudioWorkerLiveness('stopped', new Date(now - 86_400_000), now)).toBe('stopped');
  });

  it('returns unknown for unsupported statuses and invalid timestamps', () => {
    expect(classifyStudioWorkerLiveness('booting-v2', new Date(now - 1_000), now)).toBe('unknown');
    expect(classifyStudioWorkerLiveness('healthy', new Date(Number.NaN), now)).toBe('unknown');
    expect(classifyStudioWorkerLiveness('healthy', new Date(now + 120_000), now)).toBe('unknown');
  });

  it('does not misreport an unsupported heartbeat status as stopped', async () => {
    mocks.heartbeatFindMany.mockResolvedValue([{
      workerId: 'worker-unknown',
      status: 'booting-v2',
      startedAt: new Date(now - 10_000),
      lastSeenAt: new Date(now - 1_000),
      stoppedAt: null,
      metadata: {},
    }]);

    const health = await listStudioWorkerHealth();

    expect(health.state).toBe('unknown');
    expect(health.workers[0].liveness).toBe('unknown');
  });

  it('reports stopped only when every observed worker is explicitly stopped', async () => {
    mocks.heartbeatFindMany.mockResolvedValue([{
      workerId: 'worker-stopped',
      status: 'stopped',
      startedAt: new Date(now - 60_000),
      lastSeenAt: new Date(now - 1_000),
      stoppedAt: new Date(now),
      metadata: {},
    }]);

    const health = await listStudioWorkerHealth();

    expect(health.state).toBe('stopped');
    expect(health.workers[0].liveness).toBe('stopped');
  });
});
