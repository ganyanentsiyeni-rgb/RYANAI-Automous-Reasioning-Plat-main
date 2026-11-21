import {
  assessTask,
  buildOperationalReport,
  type ConnectivityMode,
  type OperationalTask,
  type TaskState,
} from './operationalAwareness.js';

export interface PersistedAgentRun {
  id: string;
  objective: string;
  status: string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
  error?: string | null;
  attempts?: number;
  maxAttempts?: number;
  handoffs?: Array<{ status: string }>;
}

function normalizeState(status: string): TaskState {
  switch (status.toLowerCase()) {
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'completed': return 'succeeded';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'paused':
    case 'paused_offline': return 'paused_offline';
    default: return 'blocked';
  }
}

/** Convert persisted run data into the shared, truthful task-awareness contract. */
export function toOperationalTask(run: PersistedAgentRun): OperationalTask {
  const handoffs = run.handoffs ?? [];
  const finishedHandoffs = handoffs.filter((handoff) => handoff.status === 'completed').length;
  const timestamp = run.updatedAt ?? run.createdAt;
  return {
    id: run.id,
    title: run.objective,
    moduleId: 'reasoning',
    state: normalizeState(run.status),
    executionSurface: 'hybrid',
    // Provider selection may be local or remote; this snapshot does not infer it.
    requiresConnectivity: false,
    localFallbackAvailable: false,
    approvalRequired: false,
    approvalGranted: true,
    progress: handoffs.length ? { completed: finishedHandoffs, total: handoffs.length } : undefined,
    updatedAt: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
    lastError: run.error ?? null,
    // A terminal status alone is not evidence of independently verified completion.
    completionVerified: false,
  };
}

export interface WorkerAwareness {
  state: 'not_started' | 'running' | 'stopped';
  listenerState: string | null;
  listenerConnected: boolean;
  listenerSubscribed: boolean;
  recoveryIntervalMs: number | null;
  lastRecoverySweepAt: string | null;
  lastNotificationAt: string | null;
  lastClaimedTask: { runId: string; claimedAt: string } | null;
  lastProcessedTask: { runId: string; completedAt: string; status: string } | null;
}

export function summarizeWorkerAwareness(status: {
  state: 'not_started' | 'running' | 'stopped';
  listener?: { state?: string; connected?: boolean; subscribed?: boolean } | null;
  recoveryIntervalMs?: number | null;
  lastRecoverySweepAt?: string | null;
  lastNotificationAt?: string | null;
  lastClaimedTask?: { runId: string; claimedAt: string } | null;
  lastProcessedTask?: { runId: string; completedAt: string; status: string } | null;
}): WorkerAwareness {
  return {
    state: status.state,
    listenerState: status.listener?.state ?? null,
    listenerConnected: status.listener?.connected === true,
    listenerSubscribed: status.listener?.subscribed === true,
    recoveryIntervalMs: status.recoveryIntervalMs ?? null,
    lastRecoverySweepAt: status.lastRecoverySweepAt ?? null,
    lastNotificationAt: status.lastNotificationAt ?? null,
    lastClaimedTask: status.lastClaimedTask ? {
      runId: status.lastClaimedTask.runId,
      claimedAt: status.lastClaimedTask.claimedAt,
    } : null,
    lastProcessedTask: status.lastProcessedTask ? {
      runId: status.lastProcessedTask.runId,
      completedAt: status.lastProcessedTask.completedAt,
      status: status.lastProcessedTask.status,
    } : null,
  };
}

export function buildUserAwarenessSnapshot(
  runs: PersistedAgentRun[],
  workerStatus: Parameters<typeof summarizeWorkerAwareness>[0],
  connectivity: ConnectivityMode,
  generatedAt = new Date().toISOString(),
) {
  const tasks = runs.map(toOperationalTask);
  return {
    generatedAt,
    source: 'persisted-agent-runs-and-live-worker-observer',
    connectivity,
    worker: summarizeWorkerAwareness(workerStatus),
    report: buildOperationalReport(tasks, connectivity, generatedAt),
    tasks: tasks.map((task) => ({ ...task, indicator: assessTask(task, connectivity) })),
  };
}
