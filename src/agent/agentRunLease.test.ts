import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentRunLeaseFilter, assertAgentRunLeaseActive, startAgentRunLeaseHeartbeat } from './agentRunLease.js';

afterEach(() => vi.useRealTimers());

describe('durable agent worker lease fencing', () => {
  it('uses run ID, worker ID, and claim attempt as the ownership fence', () => {
    expect(agentRunLeaseFilter({ id: 'run-1', workerId: 'worker-a', attempts: 2 })).toEqual({
      id: 'run-1',
      status: 'running',
      workerId: 'worker-a',
      attempts: 2,
      leaseExpiresAt: { gt: expect.any(Date) },
    });
  });

  it('refreshes the owned lease on its heartbeat interval', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({ count: 1 });
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-2', workerId: 'worker-b', attempts: 1 },
      refresh,
      vi.fn(),
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledOnce();
    const [where, heartbeatAt, leaseExpiresAt] = refresh.mock.calls[0];
    expect(where).toMatchObject({
      id: 'run-2', status: 'running', workerId: 'worker-b', attempts: 1,
      leaseExpiresAt: { gt: expect.any(Date) },
    });
    expect(heartbeatAt).toBeInstanceOf(Date);
    expect(leaseExpiresAt.getTime()).toBe(heartbeatAt.getTime() + 30_000);
    stop();
  });

  it('does not refresh after shutdown', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({ count: 1 });
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-3', workerId: 'worker-c', attempts: 3 },
      refresh,
      vi.fn(),
      5_000,
    );
    stop();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports lease loss when the heartbeat no longer owns a row', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({ count: 0 });
    const onError = vi.fn();
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-5', workerId: 'worker-e', attempts: 2 },
      refresh,
      onError,
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Agent run lease ownership was lost; this worker must stop processing.' }),
    );
    stop();
  });

  it('does not report lease loss after shutdown while a refresh is settling', async () => {
    vi.useFakeTimers();
    let resolveRefresh: ((value: { count: number }) => void) | undefined;
    const refresh = vi.fn().mockImplementation(() => new Promise<{ count: number }>((resolve) => {
      resolveRefresh = resolve;
    }));
    const onError = vi.fn();
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-6', workerId: 'worker-f', attempts: 1 },
      refresh,
      onError,
      5_000,
    );
    const advance = vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    stop();
    resolveRefresh?.({ count: 0 });
    await advance;
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports refresh errors without throwing out of the worker loop', async () => {
    vi.useFakeTimers();
    const error = new Error('database temporarily unavailable');
    const refresh = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const stop = startAgentRunLeaseHeartbeat(
      { id: 'run-4', workerId: 'worker-d', attempts: 1 },
      refresh,
      onError,
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledWith(error);
    stop();
  });

  it('revalidates durable ownership and cancellation at an execution boundary', async () => {
    const isActive = vi.fn().mockResolvedValue(true);
    await expect(assertAgentRunLeaseActive(
      { id: 'run-boundary', workerId: 'worker-boundary', attempts: 4 },
      isActive,
    )).resolves.toBeUndefined();
    expect(isActive).toHaveBeenCalledWith({
      id: 'run-boundary', status: 'running', workerId: 'worker-boundary',
      attempts: 4, leaseExpiresAt: { gt: expect.any(Date) }, cancelRequestedAt: null,
    });
  });

  it('fails closed when cancellation or lease loss is visible at the boundary', async () => {
    await expect(assertAgentRunLeaseActive(
      { id: 'run-cancelled', workerId: 'worker-x', attempts: 1 },
      vi.fn().mockResolvedValue(false),
    )).rejects.toThrow('Agent run cancelled or worker lease ownership was lost.');
    const controller = new AbortController();
    controller.abort(new Error('heartbeat lease lost'));
    const check = vi.fn();
    await expect(assertAgentRunLeaseActive(
      { id: 'run-aborted', workerId: 'worker-y', attempts: 2 },
      check,
      controller.signal,
    )).rejects.toThrow('heartbeat lease lost');
    expect(check).not.toHaveBeenCalled();
  });
});
