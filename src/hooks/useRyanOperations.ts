import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import type {
  AgentRunSummary,
  AgentTaskListResponse,
  ApprovalDecisionResponse,
  CreateAgentTaskResponse,
  CreatePADelegationResponse,
  OperationalAwareness,
  PADelegationCapability,
  PAStatusResponse,
} from '@/types/ryanai-contract';

const ACTIVE_RUN_STATES = new Set(['queued', 'running', 'leased', 'planning', 'executing']);
const POLL_INTERVAL_MS = 4_000;

export class RyanOperationsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'RyanOperationsError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (cause) {
    throw new RyanOperationsError(
      cause instanceof Error ? cause.message : 'Authenticated API request failed.',
      0,
      'API_UNREACHABLE',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object'
      ? payload as { error?: unknown; status?: unknown; ruleId?: unknown }
      : {};
    throw new RyanOperationsError(
      typeof error.error === 'string' ? error.error : `Backend rejected the request (HTTP ${response.status}).`,
      response.status,
      typeof error.ruleId === 'string' ? error.ruleId : `HTTP_${response.status}`,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new RyanOperationsError('Backend returned an empty or invalid JSON response.', response.status, 'INVALID_RESPONSE');
  }
  return payload as T;
}

function isTaskList(value: unknown): value is AgentTaskListResponse {
  return !!value && typeof value === 'object'
    && Array.isArray((value as { tasks?: unknown }).tasks)
    && (value as { tasks: unknown[] }).tasks.every((task) =>
      !!task && typeof task === 'object'
      && typeof (task as { id?: unknown }).id === 'string'
      && typeof (task as { status?: unknown }).status === 'string',
    );
}

export function useRyanOperations() {
  const [tasks, setTasks] = useState<AgentRunSummary[]>([]);
  const [awareness, setAwareness] = useState<OperationalAwareness | null>(null);
  const [paStatus, setPaStatus] = useState<PAStatusResponse['pa'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const requestSequence = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setRefreshing(true);
    try {
      const [taskResult, awarenessResult, paResult] = await Promise.allSettled([
        requestJson<unknown>('/api/agent/ops/tasks', { signal }),
        requestJson<OperationalAwareness>('/api/agent/ops/awareness', { signal }),
        requestJson<PAStatusResponse>('/api/agent/ops/pa/status', { signal }),
      ]);
      if (signal?.aborted || sequence !== requestSequence.current || !mounted.current) return;

      const diagnostics: string[] = [];
      let confirmedAnySource = false;

      if (taskResult.status === 'fulfilled' && isTaskList(taskResult.value)) {
        setTasks(taskResult.value.tasks);
        confirmedAnySource = true;
      } else {
        diagnostics.push(taskResult.status === 'rejected'
          ? taskResult.reason instanceof Error ? taskResult.reason.message : 'Task telemetry unavailable'
          : 'Task endpoint returned an invalid task list.');
      }

      if (awarenessResult.status === 'fulfilled'
        && awarenessResult.value
        && ['online', 'degraded'].includes(awarenessResult.value.status)
        && awarenessResult.value.sources
        && awarenessResult.value.globalQueue) {
        setAwareness(awarenessResult.value);
        confirmedAnySource = true;
      } else {
        diagnostics.push(awarenessResult.status === 'rejected'
          ? awarenessResult.reason instanceof Error ? awarenessResult.reason.message : 'Operational awareness unavailable'
          : 'Operational awareness response did not match its contract.');
      }

      if (paResult.status === 'fulfilled'
        && paResult.value?.pa
        && typeof paResult.value.pa === 'object') {
        setPaStatus(paResult.value.pa);
        confirmedAnySource = true;
      } else {
        setPaStatus(null);
        diagnostics.push(paResult.status === 'rejected'
          ? paResult.reason instanceof RyanOperationsError && paResult.reason.status === 503
            ? 'PA observer unavailable (HTTP 503).'
            : paResult.reason instanceof Error ? paResult.reason.message : 'PA status unavailable'
          : 'PA status response did not match its contract.');
      }

      if (confirmedAnySource) setLastConfirmedAt(new Date().toISOString());
      setError(diagnostics.length ? diagnostics.join(' ') : null);
    } catch (cause) {
      if (!signal?.aborted && sequence === requestSequence.current && mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Operational refresh failed.');
      }
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current && mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
      requestSequence.current += 1;
    };
  }, [refresh]);

  const hasActiveRuns = tasks.some((task) => ACTIVE_RUN_STATES.has(task.status.toLowerCase()));
  useEffect(() => {
    if (!hasActiveRuns) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns, refresh]);

  const refreshNow = useCallback(() => refresh(), [refresh]);

  const createTask = useCallback(async (objective: string): Promise<CreateAgentTaskResponse> => {
    if (!objective.trim()) throw new Error('Objective cannot be empty.');
    setActionPending(true);
    try {
      const result = await requestJson<CreateAgentTaskResponse>('/api/agent/ops/tasks', {
        method: 'POST',
        body: JSON.stringify({ objective: objective.trim(), taskId: crypto.randomUUID() }),
      });
      if (result.success !== true || typeof result.taskId !== 'string' || !result.taskId) {
        throw new RyanOperationsError('Backend did not confirm task creation.', 202, 'TASK_NOT_CONFIRMED');
      }
      await refreshNow();
      return result;
    } finally {
      setActionPending(false);
    }
  }, [refreshNow]);

  const decideApproval = useCallback(async (
    taskId: string,
    decision: 'approve' | 'reject',
  ): Promise<ApprovalDecisionResponse> => {
    setActionPending(true);
    try {
      const result = await requestJson<ApprovalDecisionResponse>(
        `/api/agent/ops/tasks/${encodeURIComponent(taskId)}/${decision}`,
        { method: 'POST' },
      );
      if (result.success !== true || result.taskId !== taskId
        || result.status !== (decision === 'approve' ? 'approved' : 'rejected')) {
        throw new RyanOperationsError('Backend did not confirm the requested approval decision.', 200, 'APPROVAL_NOT_CONFIRMED');
      }
      await refreshNow();
      return result;
    } finally {
      setActionPending(false);
    }
  }, [refreshNow]);

  const createPADelegation = useCallback(async (
    objective: string,
    capabilities: PADelegationCapability[],
    delegationId?: string,
  ): Promise<CreatePADelegationResponse> => {
    if (objective.trim().length < 5) throw new Error('Delegation objective must contain at least five characters.');
    if (capabilities.length === 0) throw new Error('Select at least one PA capability.');
    setActionPending(true);
    try {
      const result = await requestJson<CreatePADelegationResponse>('/api/agent/ops/pa/delegations', {
        method: 'POST',
        body: JSON.stringify({ objective: objective.trim(), capabilities, ...(delegationId ? { delegationId } : {}) }),
      });
      if (result.success !== true || !result.delegationId || !result.taskId
        || !['approved', 'pending_approval'].includes(result.status)) {
        throw new RyanOperationsError('Backend did not confirm PA delegation persistence.', 200, 'DELEGATION_NOT_CONFIRMED');
      }
      await refreshNow();
      return result;
    } finally {
      setActionPending(false);
    }
  }, [refreshNow]);

  return {
    tasks,
    awareness,
    paStatus,
    loading,
    refreshing,
    actionPending,
    error,
    lastConfirmedAt,
    hasActiveRuns,
    refresh: refreshNow,
    createTask,
    decideApproval,
    createPADelegation,
  };
}
