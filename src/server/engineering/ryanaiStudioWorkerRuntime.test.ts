import { describe, expect, it, vi } from 'vitest';
import { createRyanAIStudioWorkerRuntime } from './ryanaiStudioWorkerRuntime.js';
import { getStudioWorkerHandlerReadiness, registerStudioTaskHandler } from './studioNativeCore.js';

describe('RyanAI native Studio worker runtime', () => {
  it('reports profiles without registered native handlers as not ready', () => {
    const readiness = getStudioWorkerHandlerReadiness('repository-auditor');
    expect(getStudioWorkerHandlerReadiness('coordinator').ready).toBe(false);
    expect(readiness).toMatchObject({ workerProfileId: 'repository-auditor', ready: false, registeredTaskTypes: [] });
    expect(readiness.missingTaskTypes.length).toBeGreaterThan(0);
  });

  it('reports a profile ready only after a matching handler is registered', () => {
    const unregister = registerStudioTaskHandler('coordination', async () => ({ accepted: true }));
    try {
      expect(getStudioWorkerHandlerReadiness('coordinator')).toMatchObject({
        workerProfileId: 'coordinator',
        ready: true,
        registeredTaskTypes: ['coordination'],
      });
    } finally {
      unregister();
    }
  });

  it('rejects an unregistered worker profile', () => {
    expect(() => createRyanAIStudioWorkerRuntime({
      workerProfileId: 'not-registered',
    })).toThrow('Unknown RyanAI Studio worker profile');
  });

  it('starts with durable heartbeat and executes through the RyanAI worker boundary', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const executeOnce = vi.fn().mockResolvedValue({ state: 'completed', taskId: 'task-1' });
    const recover = vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 });

    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-test-1',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce,
      heartbeat,
      recoverExpiredLeases: recover,
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(heartbeat).toHaveBeenCalledWith(
      'studio-worker-test-1',
      expect.any(String),
      expect.objectContaining({ workerProfileId: 'coordinator' }),
    );
    expect(executeOnce).toHaveBeenCalledWith(
      'studio-worker-test-1',
      'coordinator',
      90,
      expect.any(AbortSignal),
    );

    expect(runtime.snapshot()).toMatchObject({
      workerProfileId: 'coordinator',
      status: 'healthy',
      lastExecutionState: 'completed',
    });

    await runtime.stop();
    expect(heartbeat).toHaveBeenLastCalledWith(
      'studio-worker-test-1',
      'stopped',
      expect.objectContaining({ runtime: 'ryanai-native-studio-worker' }),
    );
  });

  it('waits for an in-flight worker poll before publishing stopped', async () => {
    let finishExecution!: (value: { state: string; taskId: string }) => void;
    const pendingExecution = new Promise<{ state: string; taskId: string }>((resolve) => {
      finishExecution = resolve;
    });
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const executeOnce = vi.fn(() => pendingExecution);
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-drain',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce,
      heartbeat,
      recoverExpiredLeases: vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 }),
    });

    await runtime.start();
    await Promise.resolve();
    const stopping = runtime.stop();
    await Promise.resolve();
    expect(heartbeat).not.toHaveBeenLastCalledWith(
      'studio-worker-drain',
      'stopped',
      expect.anything(),
    );

    finishExecution({ state: 'completed', taskId: 'task-drained' });
    await stopping;

    expect(runtime.snapshot().status).toBe('stopped');
    expect(heartbeat).toHaveBeenLastCalledWith(
      'studio-worker-drain',
      'stopped',
      expect.objectContaining({ runtime: 'ryanai-native-studio-worker' }),
    );
  });

  it('aborts the execution signal before draining in-flight work', async () => {
    let receivedSignal: AbortSignal | undefined;
    let finishExecution!: (value: { state: string; taskId: string }) => void;
    const pendingExecution = new Promise<{ state: string; taskId: string }>((resolve) => { finishExecution = resolve; });
    const executeOnce = vi.fn((_id: string, _profile: string, _lease: number, signal: AbortSignal) => {
      receivedSignal = signal;
      return pendingExecution;
    });
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-abort',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce,
      heartbeat,
      recoverExpiredLeases: vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 }),
    });

    await runtime.start();
    await Promise.resolve();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);

    const stopping = runtime.stop();
    expect(receivedSignal?.aborted).toBe(true);
    expect(heartbeat).not.toHaveBeenLastCalledWith('studio-worker-abort', 'stopped', expect.anything());

    finishExecution({ state: 'interrupted', taskId: 'task-abort' });
    await stopping;
    expect(runtime.snapshot().status).toBe('stopped');
  });

  it('shares one shutdown drain across concurrent stop calls', async () => {
    let finishStopped!: () => void;
    const stoppedHeartbeat = new Promise<void>((resolve) => { finishStopped = resolve; });
    const heartbeat = vi.fn(async (_id: string, status: string) => {
      if (status === 'stopped') await stoppedHeartbeat;
    });
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-concurrent-stop',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce: vi.fn().mockResolvedValue({ state: 'idle' }),
      heartbeat,
      recoverExpiredLeases: vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 }),
    });

    await runtime.start();
    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    await vi.waitFor(() => {
      expect(heartbeat.mock.calls.filter((call) => call[1] === 'stopped')).toHaveLength(1);
    });

    finishStopped();
    await Promise.all([firstStop, secondStop]);
    expect(runtime.snapshot().status).toBe('stopped');
  });

  it('allows shutdown retry when the terminal heartbeat write fails', async () => {
    let failFirstStoppedHeartbeat = true;
    const heartbeat = vi.fn(async (_id: string, status: string) => {
      if (status === 'stopped' && failFirstStoppedHeartbeat) {
        failFirstStoppedHeartbeat = false;
        throw new Error('terminal heartbeat unavailable');
      }
    });
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-stop-retry',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce: vi.fn().mockResolvedValue({ state: 'idle' }),
      heartbeat,
      recoverExpiredLeases: vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 }),
    });

    await runtime.start();
    await expect(runtime.stop()).rejects.toThrow('terminal heartbeat unavailable');
    expect(runtime.snapshot().status).toBe('healthy');

    await runtime.stop();
    expect(runtime.snapshot().status).toBe('stopped');
    expect(heartbeat.mock.calls.filter((call) => call[1] === 'stopped')).toHaveLength(2);
  });

  it('allows startup retry after the initial durable heartbeat fails', async () => {
    const heartbeat = vi.fn()
      .mockRejectedValueOnce(new Error('heartbeat store unavailable'))
      .mockResolvedValue(undefined);
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-retry-start',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce: vi.fn().mockResolvedValue({ state: 'idle' }),
      heartbeat,
      recoverExpiredLeases: vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 }),
    });

    await expect(runtime.start()).rejects.toThrow('heartbeat store unavailable');
    expect(runtime.snapshot()).toMatchObject({ status: 'degraded', lastError: 'heartbeat store unavailable' });

    await runtime.start();
    expect(runtime.snapshot().status).toBe('healthy');
    await runtime.stop();
  });

  it('persists recovery failures as degraded worker heartbeats immediately', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'coordinator',
      workerInstanceId: 'studio-worker-recovery-failure',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce: vi.fn().mockResolvedValue({ state: 'idle' }),
      heartbeat,
      recoverExpiredLeases: vi.fn().mockRejectedValue(new Error('recovery store unavailable')),
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.snapshot()).toMatchObject({
      status: 'degraded',
      lastError: 'recovery store unavailable',
    });
    expect(heartbeat).toHaveBeenCalledWith(
      'studio-worker-recovery-failure',
      'degraded',
      expect.objectContaining({ runtime: 'ryanai-native-studio-worker' }),
    );

    await runtime.stop();
  });

  it('marks the worker degraded when the execution boundary fails', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const executeOnce = vi.fn().mockRejectedValue(new Error('queue unavailable'));
    const recover = vi.fn().mockResolvedValue({ inspected: 0, recovered: 0, failed: 0 });

    const runtime = createRyanAIStudioWorkerRuntime({
      workerProfileId: 'ci-diagnostics',
      workerInstanceId: 'studio-worker-test-2',
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      recoveryIntervalMs: 60_000,
      executeOnce,
      heartbeat,
      recoverExpiredLeases: recover,
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.snapshot()).toMatchObject({
      status: 'degraded',
      lastExecutionState: 'runtime_error',
      lastError: 'queue unavailable',
    });

    await runtime.stop();
  });
});
