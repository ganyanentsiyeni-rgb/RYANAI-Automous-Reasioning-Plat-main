export type ConnectivityMode = 'online' | 'offline' | 'degraded' | 'unknown';
export type TaskState =
  | 'queued' | 'planning' | 'awaiting_approval' | 'running' | 'retrying'
  | 'paused_offline' | 'blocked' | 'succeeded' | 'failed' | 'cancelled';
export type ExecutionSurface = 'local' | 'remote' | 'hybrid';
export type TaskIndicatorStatus =
  | 'executing' | 'queued' | 'waiting' | 'approval_required' | 'offline'
  | 'attention_required' | 'completed' | 'cancelled' | 'unknown';
export type AlertPriority = 'critical' | 'high' | 'normal' | 'silent';

export interface OperationalTask {
  id: string;
  title: string;
  moduleId: string;
  state: TaskState;
  executionSurface: ExecutionSurface;
  requiresConnectivity: boolean;
  localFallbackAvailable: boolean;
  approvalRequired: boolean;
  approvalGranted: boolean;
  progress?: { completed: number; total: number };
  updatedAt: string;
  lastError?: string | null;
  completionVerified?: boolean;
}

export interface TaskIndicator {
  status: TaskIndicatorStatus;
  icon: string;
  label: string;
  warning: 'none' | 'warning' | 'critical';
  voicePriority: AlertPriority;
  explanation: string;
}

export function assessTask(task: OperationalTask, connectivity: ConnectivityMode): TaskIndicator {
  if (task.state === 'succeeded') {
    return task.completionVerified
      ? { status: 'completed', icon: '✓', label: 'Completed and verified', warning: 'none', voicePriority: 'normal', explanation: 'The task outcome has been verified.' }
      : { status: 'attention_required', icon: '▲', label: 'Completion unverified', warning: 'warning', voicePriority: 'high', explanation: 'The task reports success but has no verification evidence.' };
  }
  if (task.state === 'failed') {
    return { status: 'attention_required', icon: '▲', label: 'Failed', warning: 'critical', voicePriority: 'critical', explanation: task.lastError || 'The task failed; inspect its execution evidence.' };
  }
  if (task.state === 'cancelled') {
    return { status: 'cancelled', icon: '⊘', label: 'Cancelled', warning: 'none', voicePriority: 'silent', explanation: 'The task was cancelled.' };
  }
  if (task.approvalRequired && !task.approvalGranted) {
    return { status: 'approval_required', icon: 'Ⅱ', label: 'Approval required', warning: 'warning', voicePriority: 'high', explanation: 'The task is waiting for explicit human approval.' };
  }
  if (connectivity !== 'online' && task.requiresConnectivity && !task.localFallbackAvailable) {
    return { status: 'offline', icon: '☾', label: 'Waiting for connectivity', warning: 'warning', voicePriority: 'normal', explanation: 'A required remote service is unavailable. The task must remain safely queued.' };
  }
  if (task.state === 'blocked') {
    return { status: 'attention_required', icon: '▲', label: 'Attention required', warning: 'critical', voicePriority: 'critical', explanation: task.lastError || 'A dependency or execution condition is blocking this task.' };
  }
  if (task.state === 'paused_offline') {
    return { status: 'offline', icon: '☾', label: 'Paused offline', warning: 'warning', voicePriority: 'normal', explanation: task.lastError || 'The task is paused until its required capability is available.' };
  }
  if (task.state === 'queued') {
    return { status: 'queued', icon: '◷', label: 'Queued', warning: 'none', voicePriority: 'silent', explanation: 'The task is queued and has not started.' };
  }
  if (task.state === 'planning') {
    return { status: 'executing', icon: '◉', label: 'Planning', warning: 'none', voicePriority: 'silent', explanation: 'The task is being assessed and planned.' };
  }
  if (task.state === 'retrying') {
    return { status: 'waiting', icon: '↻', label: 'Retrying', warning: 'warning', voicePriority: 'normal', explanation: 'The task is retrying under its configured retry policy.' };
  }
  return { status: 'executing', icon: '◉', label: 'Executing', warning: 'none', voicePriority: 'silent', explanation: 'The task is actively executing.' };
}

export interface OperationalReport {
  connectivity: ConnectivityMode;
  total: number;
  executing: number;
  queued: number;
  waiting: number;
  approvalRequired: number;
  attentionRequired: number;
  completedVerified: number;
  offlineBlocked: number;
  generatedAt: string;
}

export function buildOperationalReport(tasks: OperationalTask[], connectivity: ConnectivityMode, generatedAt = new Date().toISOString()): OperationalReport {
  const indicators = tasks.map((task) => assessTask(task, connectivity));
  return {
    connectivity,
    total: tasks.length,
    executing: indicators.filter((item) => item.status === 'executing').length,
    queued: indicators.filter((item) => item.status === 'queued').length,
    waiting: indicators.filter((item) => item.status === 'waiting').length,
    approvalRequired: indicators.filter((item) => item.status === 'approval_required').length,
    attentionRequired: indicators.filter((item) => item.status === 'attention_required').length,
    completedVerified: indicators.filter((item) => item.status === 'completed').length,
    offlineBlocked: indicators.filter((item) => item.status === 'offline').length,
    generatedAt,
  };
}

export type SkillExecutionMode = 'online' | 'offline';
export interface SkillContract {
  id: string;
  moduleId: string;
  description: string;
  executionModes: SkillExecutionMode[];
  requiredCapabilities: string[];
  requiredPermissions: string[];
  verificationRequired: boolean;
  enabled: boolean;
}

/** First platform skill consuming the shared task-awareness contract. */
export const PA_TASK_AWARENESS_SKILL: SkillContract = {
  id: 'task-awareness',
  moduleId: 'personal-assistant',
  description: 'PA observes persisted task state, worker lifecycle and recovery without dispatching work or granting permissions.',
  executionModes: ['online', 'offline'],
  requiredCapabilities: ['persisted-task-state', 'worker-runtime-awareness'],
  requiredPermissions: [],
  verificationRequired: true,
  enabled: true,
};

export function isSkillAvailable(
  skill: SkillContract,
  mode: ConnectivityMode,
  availableCapabilities: ReadonlySet<string>,
  grantedPermissions: ReadonlySet<string>,
): boolean {
  if (!skill.enabled || (mode !== 'online' && mode !== 'offline')) return false;
  const executionMode: SkillExecutionMode = mode;
  if (!skill.executionModes.includes(executionMode)) return false;
  return skill.requiredCapabilities.every((capability) => availableCapabilities.has(capability))
    && skill.requiredPermissions.every((permission) => grantedPermissions.has(permission));
}

export interface VoiceAlertEvent {
  kind: 'task_failed' | 'approval_needed' | 'task_blocked' | 'connectivity_lost' | 'connectivity_restored' | 'task_completed';
  taskId?: string;
  verified?: boolean;
}

export function voiceAlertPriority(event: VoiceAlertEvent): AlertPriority {
  switch (event.kind) {
    case 'task_failed': return 'critical';
    case 'task_blocked':
    case 'approval_needed':
    case 'connectivity_lost': return 'high';
    case 'connectivity_restored': return 'normal';
    case 'task_completed': return event.verified ? 'normal' : 'silent';
  }
}
