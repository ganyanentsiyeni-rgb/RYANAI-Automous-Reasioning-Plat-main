import { describe, expect, it, vi } from 'vitest';
import { evaluateStudioWorkerHeartbeats, inspectReadiness, isAgentWorkerReady } from './readiness.js';

const healthy = async () => 'ok';
const unavailable = async () => {
  throw new Error('sensitive connection details must not escape');
};

describe('agent worker readiness evidence', () => {
  const healthyWorker = {
    state: 'running',
    queueClaimState: 'ready',
    lastSuccessfulClaimAt: '2026-11-08T07:00:00.000Z',
    listener: { state: 'listening', connected: true, subscribed: true },
  };

  it('requires a successful durable queue claim and a subscribed listener', () => {
    expect(isAgentWorkerReady(healthyWorker)).toBe(true);
    expect(isAgentWorkerReady({ ...healthyWorker, queueClaimState: 'blocked' })).toBe(false);
    expect(isAgentWorkerReady({ ...healthyWorker, lastSuccessfulClaimAt: null })).toBe(false);
    expect(isAgentWorkerReady({ ...healthyWorker, listener: { state: 'listening', connected: true, subscribed: false } })).toBe(false);
    expect(isAgentWorkerReady({ ...healthyWorker, state: 'stopped' })).toBe(false);
  });
});

describe('live dependency readiness', () => {
  it('reports ready only when live dependencies and startup components are ready', async () => {
    await expect(
      inspectReadiness({
        database: healthy,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
        agentQueueListenerReady: true,
      }),
    ).resolves.toEqual({
      ready: true,
      services: {
        database: true,
        redis: true,
        agentCheckpointer: true,
        agentQueueListener: true,
        api: true,
      },
    });
  });

  it('marks PostgreSQL and the shared checkpointer unavailable after a failed live probe', async () => {
    const result = await inspectReadiness({
      database: unavailable,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: true,
        agentQueueListenerReady: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services).toEqual({
      database: false,
      redis: true,
      agentCheckpointer: false,
      agentQueueListener: true,
      api: true,
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });

  it('recovers readiness when a dependency probe succeeds again', async () => {
    const database = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    const probes = {
      database,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: true,
        agentQueueListenerReady: true,
    };

    expect((await inspectReadiness(probes)).ready).toBe(false);
    expect((await inspectReadiness(probes)).ready).toBe(true);
  });

  it('marks Redis unavailable when its live probe fails', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: unavailable,
      agentCheckpointerInitialized: true,
      apiListening: true,
        agentQueueListenerReady: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services.redis).toBe(false);
    expect(result.services.database).toBe(true);
  });

  it('recovers readiness when Redis becomes available again', async () => {
    const redis = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('PONG');
    const probes = {
      database: healthy,
      redis,
      agentCheckpointerInitialized: true,
      apiListening: true,
        agentQueueListenerReady: true,
    };

    expect((await inspectReadiness(probes)).ready).toBe(false);
    expect((await inspectReadiness(probes)).ready).toBe(true);
  });

  it('bounds a dependency probe that never settles', async () => {
    const neverSettles = () => new Promise<never>(() => {});
    const startedAt = Date.now();
    const result = await inspectReadiness(
      {
        database: neverSettles,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
        agentQueueListenerReady: true,
      },
      10,
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.ready).toBe(false);
    expect(result.services.database).toBe(false);
    expect(result.services.agentCheckpointer).toBe(false);
  });

  it('clamps invalid and excessive probe timeouts to a safe bound', async () => {
    const neverSettles = () => new Promise<never>(() => {});
    const startedAt = Date.now();
    const result = await inspectReadiness(
      {
        database: neverSettles,
        redis: healthy,
        agentCheckpointerInitialized: true,
        apiListening: true,
        agentQueueListenerReady: true,
      },
      Number.POSITIVE_INFINITY,
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.ready).toBe(false);
  });

  it('keeps readiness false when the checkpointer did not initialize', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: healthy,
      agentCheckpointerInitialized: false,
      apiListening: true,
        agentQueueListenerReady: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services.agentCheckpointer).toBe(false);
  });

  it('does not report ready when the agent queue listener is disconnected', async () => {
    const result = await inspectReadiness({ database: healthy, redis: healthy, agentCheckpointerInitialized: true, apiListening: true, agentQueueListenerReady: false });
    expect(result.ready).toBe(false);
    expect(result.services.agentQueueListener).toBe(false);
  });

  it('does not report ready before the API listener is active', async () => {
    const result = await inspectReadiness({
      database: healthy,
      redis: healthy,
      agentCheckpointerInitialized: true,
      apiListening: false,
        agentQueueListenerReady: true,
    });

    expect(result.ready).toBe(false);
    expect(result.services.api).toBe(false);
  });
});


describe('independent Studio worker heartbeat readiness', () => {
  const now = Date.parse('2026-11-08T10:00:00.000Z');

  it('reports healthy when any worker instance has a fresh healthy heartbeat', () => {
    expect(evaluateStudioWorkerHeartbeats([
      { workerId: 'stopped-instance', status: 'stopped', lastSeenAt: new Date(now) },
      { workerId: 'active-instance', status: 'healthy', lastSeenAt: new Date(now - 5_000) },
    ], now)).toMatchObject({ ready: true, state: 'healthy', workerId: 'active-instance', ageMs: 5_000 });
  });

  it('distinguishes missing, starting, stopped and stale worker states', () => {
    expect(evaluateStudioWorkerHeartbeats([], now).state).toBe('missing');
    expect(evaluateStudioWorkerHeartbeats([
      { workerId: 'starting', status: 'starting', lastSeenAt: new Date(now) },
    ], now).state).toBe('starting');
    expect(evaluateStudioWorkerHeartbeats([
      { workerId: 'stopped', status: 'stopped', lastSeenAt: new Date(now) },
    ], now).state).toBe('stopped');
    expect(evaluateStudioWorkerHeartbeats([
      { workerId: 'stale', status: 'healthy', lastSeenAt: new Date(now - 31_000) },
    ], now).state).toBe('stale');
  });

  it('does not let a stopped instance hide another fresh worker', () => {
    const result = evaluateStudioWorkerHeartbeats([
      { workerId: 'newly-stopped', status: 'stopped', lastSeenAt: new Date(now) },
      { workerId: 'still-running', status: 'healthy', lastSeenAt: new Date(now - 1_000) },
    ], now);
    expect(result.ready).toBe(true);
    expect(result.workerId).toBe('still-running');
  });
});
