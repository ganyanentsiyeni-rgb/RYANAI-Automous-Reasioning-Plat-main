import { describe, expect, it, vi } from 'vitest';
import { createRyanAIStudioWorkerRuntime } from './ryanaiStudioWorkerRuntime.js';

describe('RyanAI native Studio worker runtime', () => {
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
    expect(executeOnce).toHaveBeenCalledWith('studio-worker-test-1', 'coordinator', 90);

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
