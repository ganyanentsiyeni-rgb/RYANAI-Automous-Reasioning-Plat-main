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
    for (const path of ['/api/auth/verify', '/api/admin/audit-events?limit=30', '/api/admin/metrics', '/api/actions', '/api/engineering/jobs']) {
      expect(apiFetch).toHaveBeenCalledWith(path, expect.any(Object), 'admin-account-a');
    }
  });

  it('does not display an unverified identity when the verification endpoint rejects the session', async () => {
    apiFetch.mockImplementation(async (input) => {
      if (String(input) === '/api/auth/verify') return response({ error: 'Invalid or expired session.' }, false);
      if (String(input) === '/api/admin/audit-events?limit=30') return response({ events: [] });
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
