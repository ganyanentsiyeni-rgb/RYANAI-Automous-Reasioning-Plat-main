// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import OperationalAwarenessPanel from './OperationalAwarenessPanel';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const apiFetch = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

const snapshot = {
  generatedAt: '2026-11-26T10:00:00.000Z',
  databaseConnectivity: 'connected',
  status: 'online' as const,
  sources: { taskRuns: 'available' as const, database: 'available' as const, worker: 'available' as const },
  report: {
    total: 1, executing: 0, queued: 0, waiting: 0, approvalRequired: 1,
    attentionRequired: 0, completedVerified: 0, offlineBlocked: 0,
  },
  worker: {
    state: 'running', listenerState: 'subscribed', listenerConnected: true,
    listenerSubscribed: true, lastRecoverySweepAt: '2026-11-26T09:59:00.000Z',
  },
  tasks: [{
    id: 'run-pending-lease-recovered',
    title: 'Recover interrupted reasoning task',
    moduleId: 'reasoning',
    updatedAt: '2026-11-26T09:50:00.000Z',
    approvalRequired: true,
    approvalGranted: false,
    lease: {
      state: 'expired' as const,
      workerId: 'worker-7',
      lockedAt: '2026-11-26T09:40:00.000Z',
      expiresAt: '2026-11-26T09:45:00.000Z',
      heartbeatAt: '2026-11-26T09:44:00.000Z',
      nextAttemptAt: '2026-11-26T10:05:00.000Z',
      attempts: 2,
      maxAttempts: 5,
    },
    recovery: {
      recovered: true,
      recoveryCount: 3,
      lastRecoveredAt: '2026-11-26T09:55:00.000Z',
    },
    indicator: {
      icon: 'Ⅱ', label: 'Approval required', warning: 'warning',
      explanation: 'The task is waiting for explicit human approval.',
    },
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ ok: true, json: async () => snapshot } as Response);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Operational Awareness panel telemetry', () => {
  it('renders pending approval, expired lease and recovery evidence without exposing execution controls', async () => {
    await act(async () => root.render(<OperationalAwarenessPanel />));

    await vi.waitFor(() => expect(container.textContent).toContain('Recover interrupted reasoning task'));
    expect(container.textContent).toContain('Human approval required');
    expect(container.textContent).toContain('Lease: expired');
    expect(container.textContent).toContain('Worker worker-7');
    expect(container.textContent).toContain('Attempts 2/5');
    expect(container.textContent).toContain('3 recovery event(s)');
    expect(container.textContent).toContain('Read-only telemetry');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')?.textContent).toContain('Refresh');
    expect(apiFetch).toHaveBeenCalledWith('/api/agent/ops/awareness', {
      headers: { Accept: 'application/json' },
    });
  });

  it('keeps approval state pending when the API has not granted approval', async () => {
    await act(async () => root.render(<OperationalAwarenessPanel />));

    await vi.waitFor(() => expect(container.textContent).toContain('Human approval required'));
    expect(container.textContent).not.toContain('Approval: Approved');
  });
});
