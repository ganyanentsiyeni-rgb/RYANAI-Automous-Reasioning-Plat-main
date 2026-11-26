// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRyanOperations } from './useRyanOperations';

const authenticatedFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));

let state: ReturnType<typeof useRyanOperations>;
let root: Root;
let container: HTMLDivElement;

function Probe() {
  // eslint-disable-next-line react-hooks/globals
  state = useRyanOperations();
  return null;
}

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  authenticatedFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://api.example.test');
    if (url.pathname === '/api/agent/ops/pa/delegations' && init?.method === 'POST') {
      return response({
        success: true,
        delegationId: 'delegation-123',
        taskId: 'run-123',
        status: 'approved',
        createdAt: '2026-11-26T12:00:00.000Z',
      }, 202);
    }
    if (url.pathname === '/api/agent/ops/tasks') return response({ tasks: [] });
    if (url.pathname === '/api/agent/ops/awareness') {
      return response({
        status: 'degraded',
        databaseConnectivity: 'degraded',
        sources: { taskRuns: 'available', database: 'unavailable', worker: 'available', globalQueue: 'unavailable' },
        globalQueue: { available: false, queued: null, running: null, failed: null, cancelled: null, total: null },
      });
    }
    if (url.pathname === '/api/agent/ops/pa/status') return response({ pa: { active: false } });
    if (url.pathname === '/api/agent/ops/pa/delegations') return response({ delegations: [] });
    return response({ error: 'Unexpected endpoint' }, 404);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useRyanOperations PA delegation contract', () => {
  it('sends the caller-stable delegation ID and waits for backend confirmation', async () => {
    await act(async () => root.render(<Probe />));
    await vi.waitFor(() => expect(state.loading).toBe(false));

    let result: Awaited<ReturnType<typeof state.createPADelegation>> | undefined;
    await act(async () => {
      result = await state.createPADelegation(
        'Inspect current frontend readiness and report blockers.',
        ['repository.inspect', 'comms.task.create'],
        'stable-delegation-id',
      );
    });

    const post = authenticatedFetch.mock.calls.find(([, init]) =>
      (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeDefined();
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      objective: 'Inspect current frontend readiness and report blockers.',
      capabilities: ['repository.inspect', 'comms.task.create'],
      delegationId: 'stable-delegation-id',
    });
    expect(result).toMatchObject({
      success: true,
      delegationId: 'delegation-123',
      taskId: 'run-123',
      status: 'approved',
    });
    expect(state.actionPending).toBe(false);
  });

  it('does not report success when the backend denies the delegation', async () => {
    await act(async () => root.render(<Probe />));
    await vi.waitFor(() => expect(state.loading).toBe(false));
    authenticatedFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ error: 'Gen-X denied the requested capability.' }, 403);
      const path = new URL(input, 'https://api.example.test').pathname;
      if (path === '/api/agent/ops/tasks') return response({ tasks: [] });
      if (path === '/api/agent/ops/awareness') return response({
        status: 'degraded',
        databaseConnectivity: 'degraded',
        sources: { taskRuns: 'available', database: 'unavailable', worker: 'available', globalQueue: 'unavailable' },
        globalQueue: { available: false, queued: null, running: null, failed: null, cancelled: null, total: null },
      });
      if (path === '/api/agent/ops/pa/status') return response({ pa: { active: false } });
      return response({ delegations: [] });
    });

    await act(async () => {
      await expect(state.createPADelegation(
        'Inspect current frontend readiness and report blockers.',
        ['repository.inspect'],
        'stable-denied-id',
      )).rejects.toThrow('Gen-X denied the requested capability.');
    });
    expect(state.actionPending).toBe(false);
  });
});
