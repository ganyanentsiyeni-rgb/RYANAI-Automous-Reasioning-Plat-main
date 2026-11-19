export const WORKER_CONTRACT_VERSION = 1 as const;

export const WORKER_STATUSES = [
  'passed',
  'failed',
  'queued',
  'running',
  'skipped',
  'cancelled',
  'missing',
  'provider_blocked',
  'awaiting_approval',
] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export type WorkerFindingSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface WorkerExecutionContext {
  taskId: string;
  agentId: string;
  workerId: string;
  repository: string;
  branch: string;
  commitSha: string;
  pullRequestNumber?: number;
  workflowRunId?: number;
  jobIds?: number[];
}

export interface WorkerEvidence {
  kind: 'workflow_run' | 'workflow_job' | 'commit' | 'pull_request' | 'test_report' | 'security_scan' | 'log' | 'document' | 'other';
  reference: string;
  commitSha?: string;
  verified: boolean;
  observedAt?: string;
}

export interface WorkerFinding {
  code: string;
  severity: WorkerFindingSeverity;
  message: string;
  evidenceReferences: string[];
}

export interface WorkerTaskResult {
  contractVersion: typeof WORKER_CONTRACT_VERSION;
  task: WorkerExecutionContext;
  status: WorkerStatus;
  summary: string;
  evidence: WorkerEvidence[];
  findings: WorkerFinding[];
  recommendations: string[];
  blockers: string[];
  startedAt: string;
  completedAt?: string;
}

export interface WorkerResultValidation {
  valid: boolean;
  errors: string[];
  canClaimSuccess: boolean;
}

/** Terminal states are not synonymous with success. */
export function isTerminalWorkerStatus(status: WorkerStatus): boolean {
  return status !== 'queued' && status !== 'running' && status !== 'awaiting_approval';
}

/**
 * A worker may claim success only with a valid exact-head context and
 * independently addressable, verified evidence. This validates a report;
 * it does not authorize any action or replace CI/GitHub source-of-truth checks.
 */
export function validateWorkerTaskResult(result: WorkerTaskResult): WorkerResultValidation {
  const errors: string[] = [];
  const task = result.task;

  if (result.contractVersion !== WORKER_CONTRACT_VERSION) errors.push('Unsupported worker contract version.');
  if (!task.taskId.trim()) errors.push('Task ID is required.');
  if (!task.agentId.trim()) errors.push('Agent ID is required.');
  if (!task.workerId.trim()) errors.push('Worker ID is required.');
  if (!/^[^/\\\s]+\/[^/\\\s]+$/.test(task.repository)) errors.push('Repository must use owner/name form.');
  if (!task.branch.trim()) errors.push('Branch is required.');
  if (!/^[a-f0-9]{40}$/i.test(task.commitSha)) errors.push('A full 40-character commit SHA is required.');
  if (task.pullRequestNumber !== undefined && (!Number.isInteger(task.pullRequestNumber) || task.pullRequestNumber < 1)) {
    errors.push('Pull request number must be a positive integer.');
  }
  if (task.workflowRunId !== undefined && (!Number.isInteger(task.workflowRunId) || task.workflowRunId < 1)) {
    errors.push('Workflow run ID must be a positive integer.');
  }
  if (!WORKER_STATUSES.includes(result.status)) errors.push('Worker status is not recognized.');
  if (!result.summary.trim()) errors.push('A result summary is required.');
  if (!Number.isFinite(Date.parse(result.startedAt))) errors.push('A valid start timestamp is required.');

  const terminal = isTerminalWorkerStatus(result.status);
  if (terminal && !result.completedAt) errors.push('A terminal result requires completedAt.');
  if (!terminal && result.completedAt) errors.push('A non-terminal result cannot have completedAt.');
  if (result.completedAt && !Number.isFinite(Date.parse(result.completedAt))) errors.push('completedAt must be a valid timestamp.');

  const references = new Set<string>();
  for (const item of result.evidence) {
    if (!item.reference.trim()) errors.push('Evidence references must not be empty.');
    if (references.has(item.reference)) errors.push('Evidence references must be unique.');
    references.add(item.reference);
    if (item.commitSha && item.commitSha.toLowerCase() !== task.commitSha.toLowerCase()) {
      errors.push('Evidence commit SHA does not match the task head SHA.');
    }
    if (item.observedAt && !Number.isFinite(Date.parse(item.observedAt))) errors.push('Evidence observedAt must be a valid timestamp.');
  }

  for (const finding of result.findings) {
    if (!finding.code.trim() || !finding.message.trim()) errors.push('Findings require a code and message.');
    for (const reference of finding.evidenceReferences) {
      if (!references.has(reference)) errors.push('Finding references evidence that is not attached to this result: ' + reference);
    }
  }

  if (result.status === 'passed') {
    if (result.evidence.length === 0) errors.push('A passed result requires evidence.');
    if (result.evidence.some((item) => !item.verified)) errors.push('A passed result cannot include unverified evidence.');
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    canClaimSuccess: valid && result.status === 'passed' && result.evidence.length > 0 && result.evidence.every((item) => item.verified),
  };
}

/** Preserve provider and workflow outcomes; never coerce them into passed. */
export function normalizeWorkerStatus(status: WorkerStatus): WorkerStatus {
  return status;
}
