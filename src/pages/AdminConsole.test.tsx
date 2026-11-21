// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import AdminConsole from './AdminConsole';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/components/telemetry/TelemetryMetricCard', () => ({
  default: () => <div data-testid="telemetry-metric-card" />,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const apiFetch = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

const userDirectoryResponse = {
  profiles: [],
  authInventory: { status: 'not_configured', users: [], page: 1, perPage: 50 },
  coverage: 'public.profiles records plus one paginated Supabase Auth Admin page when server credentials are configured.',
  limit: 50,
  page: 1,
  search: null,
};

async function mount(userId = 'admin-account-a') {
  await act(async () => root.render(<AdminConsole userId={userId} />));
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  apiFetch.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === '/api/auth/verify') return response({ authenticated: true, user: {
      id: 'admin-account-a', email: 'admin@example.test', role: 'admin', isOwner: true,
    } });
    if (path === '/api/admin/audit-events?limit=30') return response({ events: [{
      id: 'audit-event-1', actorId: 'actor-a', eventType: 'policy.check', resourceId: 'resource-a', createdAt: '2026-11-08T12:00:00.000Z',
    }] });
    if (path === '/api/admin/users?limit=50&page=1') return response(userDirectoryResponse);
    if (path === '/api/admin/metrics') return response({
      status: 'ok', uptime: 3600, timestamp: '2026-11-08T12:00:00.000Z',
      database: { status: 'unknown', driver: 'postgresql' },
      system: { nodeVersion: 'v24.0.0', rssMemoryMB: 128, heapUsedMB: 64 },
    });
    if (path === '/api/actions' && !init?.method) return response({ actions: [{
      id: 'pending-action-1', userId: 'another-user', tool: 'send_message',
      args: { destination: 'test destination' }, summary: 'Send approved test message',
      createdAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-08T13:00:00.000Z',
    }] });
    if (path === '/api/engineering/jobs') return response({ jobs: [] });
    if (path === '/api/actions/pending-action-1/approve') return response({ status: 'executed' });
    throw new Error('Unexpected Admin Console request: ' + path);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Admin Console request ownership', () => {
  it('scopes every dashboard read to the authenticated administrator account', async () => {
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('Send approved test message'));
    expect(container.textContent).toContain('Session verified');
    expect(container.textContent).toContain('Security & audit events');
    expect(container.textContent).toContain('policy.check');
    expect(container.textContent).toContain('Owner identity confirmed by server configuration');
    for (const path of ['/api/auth/verify', '/api/admin/audit-events?limit=30', '/api/admin/users?limit=50&page=1', '/api/admin/metrics', '/api/actions', '/api/engineering/jobs']) {
      expect(apiFetch).toHaveBeenCalledWith(path, expect.any(Object), 'admin-account-a');
    }
  });

  it('does not display an unverified identity when the verification endpoint rejects the session', async () => {
    apiFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/auth/verify') return response({ error: 'Invalid or expired session.' }, false);
      if (String(input) === '/api/admin/audit-events?limit=30') return response({ events: [] });
      if (String(input) === '/api/admin/users?limit=50&page=1') return response(userDirectoryResponse);
      if (String(input) === '/api/admin/metrics') return response({
        status: 'ok', uptime: 60, timestamp: '2026-11-08T12:00:00.000Z',
        database: { status: 'unknown', driver: 'postgresql' },
        system: { nodeVersion: 'v24.0.0', rssMemoryMB: 128, heapUsedMB: 64 },
      });
      if (String(input) === '/api/actions') return response({ actions: [] });
      if (String(input) === '/api/engineering/jobs') return response({ jobs: [] });
      throw new Error('Unexpected Admin Console request: ' + String(input));
    });
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('Verification unavailable'));
    expect(container.textContent).toContain('Not verified');
    expect(container.textContent).not.toContain('admin@example.test');
  });

  it('retains last-known queue items but disables decisions after a failed refresh', async () => {
    let actionReads = 0;
    apiFetch.mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/auth/verify') return response({ authenticated: true, user: {
        id: 'admin-account-a', email: 'admin@example.test', role: 'admin', isOwner: true,
      } });
      if (path === '/api/admin/audit-events?limit=30') return response({ events: [] });
      if (path === '/api/admin/users?limit=50&page=1') return response(userDirectoryResponse);
      if (path === '/api/admin/metrics') return response({
        status: 'available', uptime: 60, timestamp: '2026-11-18T12:00:00.000Z',
        database: { status: 'unknown', driver: 'postgresql' },
        system: { nodeVersion: 'v24.0.0', rssMemoryMB: 128, heapUsedMB: 64 },
      });
      if (path === '/api/actions') {
        actionReads += 1;
        return actionReads === 1
          ? response({ actions: [{
            id: 'pending-action-1', userId: 'another-user', tool: 'send_message',
            args: { destination: 'test destination' }, summary: 'Send approved test message',
            createdAt: '2026-11-08T11:00:00.000Z', expiresAt: '2026-11-08T13:00:00.000Z',
          }] })
          : response({ error: 'Approval queue database unavailable.' }, false);
      }
      if (path === '/api/engineering/jobs') return response({ jobs: [] });
      if (path === '/api/admin/account-lifecycle/requests') return response({ requests: [] });
      throw new Error('Unexpected Admin Console request: ' + path);
    });
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('Send approved test message'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Refresh control plane')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('External action queue unavailable'));
    expect(container.textContent).toContain('Send approved test message');
    expect(container.textContent).not.toContain('No unexpired actions are waiting for administrator approval.');
    const approve = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Approve and execute'));
    expect(approve?.hasAttribute('disabled')).toBe(true);
  });

  it('shows the LangGraph initialization control only to the server-verified owner', async () => {
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('LangGraph checkpointer initialization'));
    expect([...container.querySelectorAll('button')].some(button =>
      button.textContent?.includes('Initialize LangGraph checkpointer'),
    )).toBe(true);
  });

  it('does not show the LangGraph initialization control to a non-owner administrator', async () => {
    apiFetch.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/auth/verify') return response({ authenticated: true, user: {
        id: 'admin-account-a', email: 'admin@example.test', role: 'admin', isOwner: false,
      } });
      if (path === '/api/admin/audit-events?limit=30') return response({ events: [] });
      if (path === '/api/admin/users?limit=50&page=1') return response(userDirectoryResponse);
      if (path === '/api/admin/metrics') return response({
        status: 'ok', uptime: 60, timestamp: '2026-11-18T12:00:00.000Z',
        database: { status: 'unknown', driver: 'postgresql' },
        system: { nodeVersion: 'v24.0.0', rssMemoryMB: 128, heapUsedMB: 64 },
      });
      if (path === '/api/actions' && !init?.method) return response({ actions: [] });
      if (path === '/api/engineering/jobs') return response({ jobs: [] });
      throw new Error('Unexpected Admin Console request: ' + path);
    });
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('Session verified'));
    expect(container.textContent).not.toContain('LangGraph checkpointer initialization');
  });

  it('requires the exact owner confirmation before invoking LangGraph setup and displays its result', async () => {
    const prompt = vi.fn().mockReturnValue('INITIALIZE LANGGRAPH');
    vi.stubGlobal('prompt', prompt);
    apiFetch.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/auth/verify') return response({ authenticated: true, user: {
        id: 'admin-account-a', email: 'admin@example.test', role: 'admin', isOwner: true,
      } });
      if (path === '/api/admin/audit-events?limit=30') return response({ events: [] });
      if (path === '/api/admin/users?limit=50&page=1') return response(userDirectoryResponse);
      if (path === '/api/admin/metrics') return response({
        status: 'ok', uptime: 60, timestamp: '2026-11-18T12:00:00.000Z',
        database: { status: 'unknown', driver: 'postgresql' },
        system: { nodeVersion: 'v24.0.0', rssMemoryMB: 128, heapUsedMB: 64 },
      });
      if (path === '/api/actions' && !init?.method) return response({ actions: [] });
      if (path === '/api/engineering/jobs') return response({ jobs: [] });
      if (path === '/api/admin/operations/langgraph-checkpointer/setup' && init?.method === 'POST') {
        return response({ status: 'initialized', agentCheckpointer: true, migrationVersion: 5 });
      }
      throw new Error('Unexpected Admin Console request: ' + path);
    });
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('LangGraph checkpointer initialization'));
    await click([...container.querySelectorAll('button')].find(button =>
      button.textContent?.includes('Initialize LangGraph checkpointer'),
    ) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('migration version 5'));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('INITIALIZE LANGGRAPH'));
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/admin/operations/langgraph-checkpointer/setup',
      { method: 'POST', headers: { Accept: 'application/json' } },
      'admin-account-a',
    );
  });

  it('scopes an explicitly confirmed pending-action decision to the same account', async () => {
    await mount('admin-account-a');
    await vi.waitFor(() => expect(container.textContent).toContain('Send approved test message'));
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Approve and execute')) ?? null);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/actions/pending-action-1/approve',
      { method: 'POST' },
      'admin-account-a',
    ));
    expect(window.confirm).toHaveBeenCalled();
  });
});
