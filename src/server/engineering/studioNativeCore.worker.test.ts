import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  taskFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  taskFindUnique: vi.fn(),
  taskUpdateMany: vi.fn(),
  eventCreate: vi.fn(),
  directTaskUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    studioTask: { findFirst: mocks.taskFindFirst, updateMany: mocks.directTaskUpdateMany },
    studioEvent: { create: mocks.eventCreate },
  },
}));

import { recoverExpiredStudioLeases, registerStudioTaskHandler, runStudioWorkerOnce } from './studioNativeCore.js';
import { createRyanAICiDiagnosticsTaskHandler } from './ryanaiCiDiagnosticsWorker.js';

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  projectId: 'project-1',
  ownerUserId: 'owner-1',
  taskType: 'ci-failure',
  assignedWorkerId: 'ci-diagnostics',
  requiredCapabilities: ['read-workflow-runs'],
  approvalRequired: false,
  approvalStatus: 'not_required',
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  leaseToken: 'lease-token-1',
  ...overrides,
});

describe('Studio worker queue lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const transactionClient = {
      $queryRawUnsafe: mocks.queryRawUnsafe,
      studioTask: { findMany: mocks.taskFindMany, findUnique: mocks.taskFindUnique, updateMany: mocks.taskUpdateMany },
      studioEvent: { create: mocks.eventCreate },
    };
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient));
    mocks.queryRawUnsafe.mockResolvedValue([task()]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.taskFindFirst.mockResolvedValue(null);
    mocks.taskFindUnique.mockResolvedValue(task());
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.directTaskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.eventCreate.mockResolvedValue({});
  });

  it('releases a token-fenced lease when the optional authorizer fails', async () => {
    mocks.queryRawUnsafe
      .mockResolvedValueOnce([task()])
      .mockResolvedValueOnce([{ id: 'task-1' }]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const authorize = vi.fn().mockRejectedValue(new Error('authorization service unavailable'));
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics', 90, authorize);
      expect(result).toMatchObject({ state: 'failed', taskId: 'task-1', error: 'authorization service unavailable' });
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1', leaseOwner: 'worker-1', leaseToken: 'lease-token-1' }),
        data: expect.objectContaining({ status: 'queued', leaseOwner: null, leaseToken: null }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.authorization_failed' }),
      }));
    } finally {
      unregister();
    }
  });

  it('does not append authorization evidence after the claimed lease has already been lost', async () => {
    mocks.queryRawUnsafe
      .mockResolvedValueOnce([task()])
      .mockResolvedValueOnce([]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'lease_lost', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.eventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_authorized' }),
      }));
    } finally {
      unregister();
    }
  });

  it('blocks a task whose requested capabilities exceed its assigned RyanAI worker', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({ requiredCapabilities: ['production.deploy'] })]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'blocked', approvalStatus: 'blocked' }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_blocked' }),
      }));
    } finally {
      unregister();
    }
  });

  it('blocks a task until its persisted owner approval is approved', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({ approvalRequired: true, approvalStatus: 'pending' })]);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_blocked' }),
      }));
    } finally {
      unregister();
    }
  });

  it('blocks tasks without an assigned RyanAI worker before invoking a handler', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({ assignedWorkerId: null })]);
    const handler = vi.fn();
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'blocked', taskId: 'task-1' });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it('retries handler failures with an execution-failed event', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('temporary handler fault'));
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'failed', taskId: 'task-1', error: 'temporary handler fault' });
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'queued', leaseOwner: null, leaseExpiresAt: null }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.execution_failed' }),
      }));
    } finally {
      unregister();
    }
  });

  it('runs coordinator tasks through RyanAI-native admission', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([task({
      taskType: 'coordination',
      assignedWorkerId: 'coordinator',
      requiredCapabilities: [],
    })]);
    const handler = vi.fn().mockResolvedValue({ kind: 'coordination.receipt', status: 'accepted' });
    const unregister = registerStudioTaskHandler('coordination', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'coordinator');
      expect(result).toMatchObject({ state: 'completed', taskId: 'task-1' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.policy_authorized', actorId: 'worker-1' }),
      }));
    } finally {
      unregister();
    }
  });

  it('runs an authorized handler, renews its lease and commits completion', async () => {
    const handler = vi.fn().mockImplementation(async ({ heartbeat }: { heartbeat: () => Promise<boolean> }) => {
      expect(await heartbeat()).toBe(true);
      return { result: 'ok' };
    });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'completed', taskId: 'task-1' });
      expect(mocks.directTaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1', status: 'running', leaseOwner: 'worker-1', leaseToken: 'lease-token-1' }),
      }));
      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', output: { result: 'ok' } }),
      }));
    } finally {
      unregister();
    }
  });

  it('does not report completion after the worker loses its lease', async () => {
    mocks.taskUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const handler = vi.fn().mockResolvedValue({ result: 'late' });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({
        state: 'failed',
        taskId: 'task-1',
        error: 'Studio worker lease expired before completion could be committed.',
      });
      expect(mocks.eventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.completed' }),
      }));
    } finally {
      unregister();
    }
  });



  it('executes owner-bound exact-SHA CI diagnostics and persists sanitized report output end to end', async () => {
    const headSha = 'a'.repeat(40);
    const inspect = vi.fn().mockResolvedValue({
      repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
      requestedHeadSha: headSha,
      verifiedHeadSha: headSha,
      source: 'github-oauth-read-only',
      inspectedAt: '2026-11-19T18:00:00.000Z',
      workflowRuns: [{
        id: 77, name: 'CI', headSha, status: 'completed', conclusion: 'failure',
        url: 'https://github.com/example/repo/actions/runs/77',
        jobs: [{ id: 700, name: 'typecheck', status: 'completed', conclusion: 'failure' }],
      }],
      jobLogExcerpts: [{
        runId: 77, jobName: 'typecheck', excerpt: 'error TS2322: synthetic private source',
        lineCount: 1,
      }],
      jobLogStatus: 'complete',
      complete: true,
    });
    mocks.queryRawUnsafe.mockResolvedValue([task({
      input: { headSha },
      requiredCapabilities: ['read-workflow-runs', 'read-job-logs'],
    })]);
    const handler = createRyanAICiDiagnosticsTaskHandler(inspect);
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'completed', taskId: 'task-1' });
      expect(inspect).toHaveBeenCalledWith('owner-1', headSha, { includeJobLogs: true });
      const completion = mocks.taskUpdateMany.mock.calls.find(([args]) => args.data?.status === 'completed');
      expect(completion?.[0].data.output).toMatchObject({
        kind: 'ci.diagnostics',
        source: 'github-oauth-read-only',
        evidenceTrust: 'github_verified_exact_sha',
        requestedHeadSha: headSha,
        verifiedHeadSha: headSha,
        jobLogRetrievalStatus: 'complete',
        liveProviderFetchPerformed: true,
        jobLogEvidence: { authorized: true, analyzedCount: 1, rawLogTextReturned: false },
      });
      expect(JSON.stringify(completion?.[0].data.output)).not.toContain('synthetic private source');
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ eventType: 'task.completed', taskId: 'task-1' }),
      }));
    } finally {
      unregister();
    }
  });

  it('does not request or analyze job logs when read-job-logs is absent', async () => {
    const headSha = 'b'.repeat(40);
    const inspect = vi.fn().mockResolvedValue({
      repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
      requestedHeadSha: headSha,
      verifiedHeadSha: headSha,
      source: 'github-oauth-read-only',
      inspectedAt: '2026-11-19T18:00:00.000Z',
      workflowRuns: [],
      jobLogExcerpts: [{ runId: 1, jobName: 'build', excerpt: 'FAIL synthetic secret', lineCount: 1 }],
      jobLogStatus: 'not_requested',
      complete: true,
    });
    mocks.queryRawUnsafe.mockResolvedValue([task({
      input: { headSha },
      requiredCapabilities: ['read-workflow-runs'],
    })]);
    const unregister = registerStudioTaskHandler('ci-failure', createRyanAICiDiagnosticsTaskHandler(inspect));
    try {
      await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(inspect).toHaveBeenCalledWith('owner-1', headSha, { includeJobLogs: false });
      const completion = mocks.taskUpdateMany.mock.calls.find(([args]) => args.data?.status === 'completed');
      expect(completion?.[0].data.output.jobLogEvidence).toMatchObject({
        authorized: false, analyzedCount: 0, rawLogTextReturned: false,
      });
      expect(JSON.stringify(completion?.[0].data.output)).not.toContain('synthetic secret');
    } finally {
      unregister();
    }
  });



  it('never reports all checks passed when exact-head workflow pagination is incomplete', async () => {
    const headSha = 'e'.repeat(40);
    const inspect = vi.fn().mockResolvedValue({
      repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
      requestedHeadSha: headSha,
      verifiedHeadSha: headSha,
      source: 'github-oauth-read-only',
      inspectedAt: '2026-11-19T18:30:00.000Z',
      workflowRuns: [{
        id: 88, name: 'visible-build', headSha, status: 'completed', conclusion: 'success',
        url: null, jobs: [],
      }],
      jobLogExcerpts: [],
      jobLogStatus: 'not_requested',
      complete: false,
    });
    mocks.queryRawUnsafe.mockResolvedValue([task({
      input: { headSha },
      requiredCapabilities: ['read-workflow-runs'],
    })]);
    const unregister = registerStudioTaskHandler('ci-failure', createRyanAICiDiagnosticsTaskHandler(inspect));
    try {
      const result = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(result).toMatchObject({ state: 'completed', taskId: 'task-1' });
      const completion = mocks.taskUpdateMany.mock.calls.find(([args]) => args.data?.status === 'completed');
      expect(completion?.[0].data.output).toMatchObject({
        evidenceTrust: 'github_verified_exact_sha',
        snapshotComplete: false,
        summary: 'checks_incomplete',
        counts: { passed: 1 },
      });
      expect(completion?.[0].data.output.summary).not.toBe('all_observed_runs_passed');
    } finally {
      unregister();
    }
  });

  it('persists provider-blocked output when the provider verifies a different commit SHA', async () => {
    const requestedHeadSha = 'c'.repeat(40);
    const inspect = vi.fn().mockResolvedValue({
      repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
      requestedHeadSha,
      verifiedHeadSha: 'd'.repeat(40),
      source: 'github-oauth-read-only',
      inspectedAt: '2026-11-19T18:00:00.000Z',
      workflowRuns: [],
      jobLogExcerpts: [],
      jobLogStatus: 'not_requested',
      complete: true,
    });
    mocks.queryRawUnsafe.mockResolvedValue([task({ input: { headSha: requestedHeadSha } })]);
    const unregister = registerStudioTaskHandler('ci-failure', createRyanAICiDiagnosticsTaskHandler(inspect));
    try {
      await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      const completion = mocks.taskUpdateMany.mock.calls.find(([args]) => args.data?.status === 'completed');
      expect(completion?.[0].data.output).toMatchObject({
        evidenceTrust: 'provider_blocked',
        summary: 'provider_blocked',
        counts: { passed: 0, providerBlocked: 1 },
      });
      expect(completion?.[0].data.output).not.toHaveProperty('verifiedHeadSha');
    } finally {
      unregister();
    }
  });

  it('records lease recovery only for rows this process successfully transitions', async () => {
    mocks.taskFindMany.mockResolvedValue([
      { id: 'task-a', projectId: 'project-1', ownerUserId: 'owner-1', leaseToken: 'lease-a', attempts: 1, maxAttempts: 3 },
      { id: 'task-b', projectId: 'project-1', ownerUserId: 'owner-1', leaseToken: 'lease-b', attempts: 3, maxAttempts: 3 },
    ]);
    mocks.taskUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await recoverExpiredStudioLeases();

    expect(result).toEqual({ inspected: 2, recovered: 1, failed: 0 });
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'task.lease_recovered', taskId: 'task-a' }),
    }));
  });
  it('fences heartbeat renewal by attempt even when the same worker ID is reused', async () => {
    const { heartbeatStudioTask } = await import('./studioNativeCore.js');
    await heartbeatStudioTask('task-1', 'worker-1', 'lease-token-1');
    expect(mocks.directTaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-1', leaseOwner: 'worker-1', leaseToken: 'lease-token-1' }),
    }));
  });

  it('fences completion and retry release by the claimed attempt number', async () => {
    const handler = vi.fn().mockResolvedValue({ result: 'attempt-one' });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      const writes = mocks.taskUpdateMany.mock.calls.map(([arg]) => arg);
      expect(writes.some((arg) => arg.where?.leaseToken === 'lease-token-1' && arg.data?.status === 'completed')).toBe(true);
    } finally { unregister(); }
  });

  it('includes the observed attempt and lease owner in recovery compare-and-set', async () => {
    mocks.taskFindMany.mockResolvedValue([{ id: 'task-a', projectId: 'project-1', ownerUserId: 'owner-1', leaseToken: 'expired-token', attempts: 2, maxAttempts: 3 }]);
    await recoverExpiredStudioLeases();
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-a', status: 'running', leaseToken: 'expired-token', attempts: 2 }),
    }));
  });


  it('prevents a delayed old attempt from overwriting a replacement attempt after lease recovery', async () => {
    let finishFirstAttempt!: (value: unknown) => void;
    let markFirstAttemptStarted!: () => void;
    const firstAttemptStarted = new Promise<void>((resolve) => { markFirstAttemptStarted = resolve; });
    const firstAttemptResult = new Promise((resolve) => { finishFirstAttempt = resolve; });
    const claims = [
      task({ attempts: 1, leaseToken: 'old-lease-token' }),
      task({ attempts: 2, leaseToken: 'new-lease-token' }),
    ];
    mocks.queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.trimStart().startsWith('SELECT id FROM public.studio_tasks')) return [{ id: 'task-1' }];
      return [claims.shift()];
    });
    mocks.taskFindMany.mockResolvedValue([{
      id: 'task-1',
      projectId: 'project-1',
      ownerUserId: 'owner-1',
      leaseOwner: 'worker-1',
      leaseToken: 'old-lease-token',
      attempts: 1,
      maxAttempts: 3,
    }]);
    mocks.taskUpdateMany.mockImplementation(async (args: { where?: { leaseToken?: string }; data?: { status?: string } }) => {
      if (args.where?.leaseToken === 'old-lease-token' && args.data?.status === 'queued') return { count: 1 };
      if (args.where?.leaseToken === 'new-lease-token' && args.data?.status === 'completed') return { count: 1 };
      if (args.where?.leaseToken === 'old-lease-token' && args.data?.status === 'completed') return { count: 0 };
      return { count: 0 };
    });


    const handler = vi.fn(async ({ task: claimedTask }: { task: ReturnType<typeof task> }) => {
      if (claimedTask.attempts === 1) {
        markFirstAttemptStarted();
        return firstAttemptResult;
      }
      return { result: 'replacement-attempt', attempt: claimedTask.attempts };
    });
    const unregister = registerStudioTaskHandler('ci-failure', handler);
    try {
      const oldAttempt = runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      await firstAttemptStarted;

      const recovery = await recoverExpiredStudioLeases();
      expect(recovery).toEqual({ inspected: 1, recovered: 1, failed: 0 });

      const replacement = await runStudioWorkerOnce('worker-1', 'ci-diagnostics');
      expect(replacement).toMatchObject({ state: 'completed', taskId: 'task-1' });

      finishFirstAttempt({ result: 'stale-attempt-output', attempt: 1 });
      const stale = await oldAttempt;
      expect(stale).toMatchObject({
        state: 'failed',
        taskId: 'task-1',
        error: 'Studio worker lease expired before completion could be committed.',
      });

      expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1', leaseToken: 'old-lease-token', status: 'running' }),
        data: expect.objectContaining({ status: 'completed', output: { result: 'stale-attempt-output', attempt: 1 } }),
      }));
      expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'task.completed',
          payload: { attempt: 2 },
        }),
      }));
      expect(mocks.eventCreate).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'task.completed',
          payload: { attempt: 1 },
        }),
      }));
    } finally {
      unregister();
    }
  });

});