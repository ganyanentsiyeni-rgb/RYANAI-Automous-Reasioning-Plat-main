/**
 * Browser-facing contracts for endpoints that currently exist in the API.
 * These types deliberately do not assert a 12-agent/10-worker registry or
 * detailed MCP/Comms endpoints until the backend publishes those contracts.
 */
export type PlatformReadiness = 'online' | 'degraded' | 'unavailable';
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'unknown';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'not_required' | 'unknown';

export interface OperationalSources {
  taskRuns: 'available' | 'unavailable';
  database: 'available' | 'unavailable';
  worker: 'available' | 'unavailable';
  globalQueue: 'available' | 'unavailable';
}

export interface GlobalQueueSnapshot {
  available: boolean;
  queued: number | null;
  running: number | null;
  failed: number | null;
  cancelled: number | null;
  total: number | null;
}

export interface OperationalAwareness {
  status: 'online' | 'degraded';
  databaseConnectivity: 'online' | 'degraded';
  sources: OperationalSources;
  globalQueue: GlobalQueueSnapshot;
  [snapshotField: string]: unknown;
}

export interface AgentRunSummary {
  id: string;
  status: AgentRunStatus | string;
  objective?: string;
  approvalStatus?: ApprovalStatus | string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  error?: string | null;
  [field: string]: unknown;
}

export interface AgentTaskListResponse {
  tasks: AgentRunSummary[];
}

export interface CreateAgentTaskResponse {
  success: true;
  taskId: string;
  status: string;
  createdAt: string;
}

export interface ApprovalDecisionResponse {
  success: true;
  status: 'approved' | 'rejected';
  taskId: string;
  approvedBy?: string;
  approvedAt?: string;
  decidedAt?: string;
}

export type PADelegationCapability =
  | 'repository.inspect'
  | 'diagnostics.run'
  | 'ai-inspector.inspect'
  | 'patch.propose'
  | 'tests.run'
  | 'evidence.record'
  | 'comms.task.create'
  | 'deployment.execute';

export interface CreatePADelegationResponse {
  success: true;
  delegationId: string;
  taskId: string;
  status: 'approved' | 'pending_approval';
  createdAt: string;
  functionalApproval?: { authority: 'Gen-X'; decision: 'ALLOW' };
}

export interface PAStatusResponse {
  pa: Record<string, unknown>;
}

export interface ApiErrorPayload {
  error?: string;
  status?: string;
  ruleId?: string;
  capability?: string;
}
