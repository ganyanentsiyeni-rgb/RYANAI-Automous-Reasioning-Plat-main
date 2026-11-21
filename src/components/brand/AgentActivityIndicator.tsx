import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, ShieldAlert, CircleHelp, type LucideIcon } from 'lucide-react';

export type AgentActivityState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'unknown';

const ACTIVITY_PRESENTATION: Record<AgentActivityState, {
  label: string;
  icon: LucideIcon;
  tone: string;
  description: string;
}> = {
  queued: { label: 'Queued', icon: Clock3, tone: 'queued', description: 'Waiting for an execution worker' },
  running: { label: 'Running', icon: LoaderCircle, tone: 'running', description: 'Execution is reported active by the source system' },
  completed: { label: 'Completed', icon: CheckCircle2, tone: 'completed', description: 'The source system reports successful completion' },
  failed: { label: 'Failed', icon: AlertCircle, tone: 'failed', description: 'The source system reports execution failure' },
  blocked: { label: 'Blocked', icon: ShieldAlert, tone: 'blocked', description: 'Execution is blocked pending an authorised action' },
  unknown: { label: 'Unknown', icon: CircleHelp, tone: 'unknown', description: 'No verified execution state is available' },
};

type AgentActivityIndicatorProps = {
  state: AgentActivityState;
  className?: string;
};

/** Renders only the state supplied by the caller; it never infers execution. */
export default function AgentActivityIndicator({
  state,
  className = '',
}: AgentActivityIndicatorProps) {
  const presentation = ACTIVITY_PRESENTATION[state] ?? ACTIVITY_PRESENTATION.unknown;
  const Icon = presentation.icon;

  return (
    <span
      className={`ryan-activity-indicator ryan-activity-indicator--${presentation.tone} ${className}`.trim()}
      role="status"
      aria-label={`Execution status: ${presentation.label}`}
      title={presentation.description}
      data-activity-state={state}
    >
      <Icon
        aria-hidden="true"
        className={`ryan-activity-indicator__icon${state === 'running' ? ' is-running' : ''}`}
      />
      <span>{presentation.label}</span>
    </span>
  );
}
