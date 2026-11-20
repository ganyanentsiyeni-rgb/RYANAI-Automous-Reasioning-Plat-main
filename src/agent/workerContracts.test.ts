import { describe, expect, it } from 'vitest';
import {
  isTerminalWorkerStatus,
  normalizeWorkerStatus,
  validateWorkerTaskResult,
  type WorkerTaskResult,
} from './workerContracts.js';

const sha = 'a'.repeat(40);
const base: WorkerTaskResult = {
  contractVersion: 1,
  task: {
    taskId: 'task-123',
    agentId: 'github-module-agent',
    workerId: 'ci-diagnostics',
    repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
    branch: 'feat/evo-04-worker-contracts',
    commitSha: sha,
    pullRequestNumber: 309,
    workflowRunId: 44500000001,
    jobIds: [44500000002],
  },
  status: 'passed',
  summary: 'The exact-head checks completed successfully.',
  evidence: [{ kind: 'workflow_run', reference: 'run:44500000001', commitSha: sha, verified: true }],
  findings: [],
  recommendations: [],
  blockers: [],
  startedAt: '2026-11-19T16:00:00.000Z',
  completedAt: '2026-11-19T16:01:00.000Z',
};

describe('worker execution contracts', () => {
  it('accepts a passed result with verified evidence tied to the exact head SHA', () => {
    expect(validateWorkerTaskResult(base)).toEqual({ valid: true, errors: [], canClaimSuccess: true });
  });

  it('rejects success without evidence', () => {
    const result = validateWorkerTaskResult({ ...base, evidence: [] });
    expect(result.valid).toBe(false);
    expect(result.canClaimSuccess).toBe(false);
    expect(result.errors).toContain('A passed result requires evidence.');
  });

  it('rejects unverified evidence for a passed result', () => {
    const result = validateWorkerTaskResult({
      ...base,
      evidence: [{ kind: 'workflow_run', reference: 'run:queued', verified: false }],
    });
    expect(result.canClaimSuccess).toBe(false);
    expect(result.errors).toContain('A passed result cannot include unverified evidence.');
  });

  it('rejects evidence from a different commit', () => {
    const result = validateWorkerTaskResult({
      ...base,
      evidence: [{ kind: 'workflow_run', reference: 'run:old-head', commitSha: 'b'.repeat(40), verified: true }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Evidence commit SHA does not match the task head SHA.');
  });

  it('requires exact repository, branch and full commit identity', () => {
    const result = validateWorkerTaskResult({
      ...base,
      task: { ...base.task, repository: 'RyanAI', branch: '', commitSha: 'abc123' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Repository must use owner/name form.',
      'Branch is required.',
      'A full 40-character commit SHA is required.',
    ]));
  });

  it('requires findings to cite attached evidence', () => {
    const result = validateWorkerTaskResult({
      ...base,
      findings: [{ code: 'CI-001', severity: 'error', message: 'Build failed.', evidenceReferences: ['run:not-attached'] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Finding references evidence that is not attached to this result: run:not-attached');
  });

  it('keeps queued, skipped, cancelled and provider-blocked states distinct', () => {
    for (const status of ['queued', 'running', 'skipped', 'cancelled', 'missing', 'provider_blocked', 'awaiting_approval'] as const) {
      expect(normalizeWorkerStatus(status)).toBe(status);
    }
  });

  it('does not treat queued or awaiting-approval work as terminal', () => {
    expect(isTerminalWorkerStatus('queued')).toBe(false);
    expect(isTerminalWorkerStatus('running')).toBe(false);
    expect(isTerminalWorkerStatus('awaiting_approval')).toBe(false);
    expect(isTerminalWorkerStatus('skipped')).toBe(true);
    expect(isTerminalWorkerStatus('cancelled')).toBe(true);
  });

  it('requires completedAt only for terminal states', () => {
    expect(validateWorkerTaskResult({ ...base, status: 'running', completedAt: undefined }).valid).toBe(true);
    expect(validateWorkerTaskResult({ ...base, status: 'running' }).errors).toContain('A non-terminal result cannot have completedAt.');
    expect(validateWorkerTaskResult({ ...base, status: 'failed', completedAt: undefined }).errors).toContain('A terminal result requires completedAt.');
  });
});
