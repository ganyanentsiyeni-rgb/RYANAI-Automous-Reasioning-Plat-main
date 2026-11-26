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
  approvalStatus?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
  error?: string | null;
  attempts?: number;
  maxAttempts?: number;
  workerId?: string | null;
  lockedAt?: Date | string | null;
  leaseExpiresAt?: Date | string | null;
  heartbeatAt?: Date | string | null;
  nextAttemptAt?: Date | string | null;
  handoffs?: Array<{ status: string }>;
  evidence?: Array<{ eventType: string; createdAt?: Date | string }>;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
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
export function toOperationalTask(run: PersistedAgentRun, now = new Date()): OperationalTask {
  const handoffs = run.handoffs ?? [];
  const finishedHandoffs = handoffs.filter((handoff) => handoff.status === 'completed').length;
  const timestamp = run.updatedAt ?? run.createdAt;
  const approvalStatus = (run.approvalStatus ?? 'pending').toLowerCase();
  const approvalRequired = approvalStatus === 'pending';
  const approvalGranted = approvalStatus === 'approved';
  const leaseExpiresAt = asIso(run.leaseExpiresAt);
  const leaseExpired = run.status.toLowerCase() === 'running'
    && leaseExpiresAt !== null
    && new Date(leaseExpiresAt).getTime() <= now.getTime();
  const recoveryEvents = (run.evidence ?? [])
    .filter((event) => event.eventType === 'execution.recovered')
    .sort((a, b) => new Date(asIso(b.createdAt) ?? 0).getTime() - new Date(asIso(a.createdAt) ?? 0).getTime());

  let state = approvalRequired ? 'awaiting_approval' as TaskState : normalizeState(run.status);
  if (leaseExpired && state === 'running') state = 'retrying';

  return {
    id: run.id,
    title: run.objective,
    moduleId: 'reasoning',
    state,
    executionSurface: 'hybrid',
    requiresConnectivity: false,
    localFallbackAvailable: false,
    approvalRequired,
    approvalGranted,
    progress: handoffs.length ? { completed: finishedHandoffs, total: handoffs.length } : undefined,
    updatedAt: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
    lastError: run.error ?? null,
    completionVerified: false,
    lease: {
      state: leaseExpiresAt === null ? 'unleased' : leaseExpired ? 'expired' : 'active',
      workerId: run.workerId ?? null,
      lockedAt: asIso(run.lockedAt),
      expiresAt: leaseExpiresAt,
      heartbeatAt: asIso(run.heartbeatAt),
      nextAttemptAt: asIso(run.nextAttemptAt),
      attempts: run.attempts ?? 0,
      maxAttempts: run.maxAttempts ?? null,
    },
    recovery: {
      recovered: recoveryEvents.length > 0,
      recoveryCount: recoveryEvents.length,
      lastRecoveredAt: asIso(recoveryEvents[0]?.createdAt),
    },
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
  const tasks = runs.map((run) => toOperationalTask(run, new Date(generatedAt)));
  return {
    generatedAt,
    source: 'persisted-agent-runs-and-live-worker-observer',
    connectivity,
    worker: summarizeWorkerAwareness(workerStatus),
    report: buildOperationalReport(tasks, connectivity, generatedAt),
    tasks: tasks.map((task) => ({ ...task, indicator: assessTask(task, connectivity) })),
  };
}
