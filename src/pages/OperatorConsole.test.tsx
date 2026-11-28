// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import OperatorConsole from './OperatorConsole';
import { listOfflineTasks } from '@/lib/offlineTaskOutbox';
import { replayOfflineTaskBatch } from '@/lib/offlineTaskSyncClient';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'operator-account-a', is_anonymous: false } } }, error: null })),
    },
  },
}));
vi.mock('@/lib/offlineTaskOutbox', () => ({
  enqueueOfflineTask: vi.fn(),
  listOfflineTasks: vi.fn(async () => []),
  recordOfflineTaskFailure: vi.fn(),
}));
vi.mock('@/lib/offlineTaskSyncClient', () => ({ replayOfflineTaskBatch: vi.fn() }));
vi.mock('@/components/OperationalAwarenessPanel', () => ({ default: () => <div /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const apiFetch = vi.mocked(authenticatedFetch);
const listOfflineTasksMock = vi.mocked(listOfflineTasks);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(replayOfflineTaskBatch).mockResolvedValue({ acceptedIds: [], rejectedIds: [], error: null });
  apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ tasks: [] }),
  } as Response);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Operator Console account ownership', () => {
  it('loads task history using the account identity supplied by the authenticated app', async () => {
    await act(async () => root.render(<OperatorConsole userId="operator-account-a" />));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/agent/ops/tasks',
      { headers: { Accept: 'application/json' } },
      'operator-account-a',
    ));
  });

  it('loads the offline outbox using the authenticated account identity', async () => {
    await act(async () => root.render(<OperatorConsole userId="operator-account-a" />));
    await vi.waitFor(() => expect(listOfflineTasksMock).toHaveBeenCalledWith('operator-account-a'));
  });

  it('never renders offline tasks owned by a different account', async () => {
    listOfflineTasksMock.mockResolvedValue([{
      taskId: 'foreign-task',
      ownerId: 'operator-account-b',
      objective: 'A task belonging to another account',
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    }]);
    await act(async () => root.render(<OperatorConsole userId="operator-account-a" />));
    await vi.waitFor(() => expect(listOfflineTasksMock).toHaveBeenCalledWith('operator-account-a'));
    expect(container.textContent).not.toContain('A task belonging to another account');
    expect(container.textContent).toContain('No local tasks are waiting for server acceptance.');
  });

  it('does not load account task history without an authenticated account identity', async () => {
    await act(async () => root.render(<OperatorConsole userId="" />));
    await act(async () => await Promise.resolve());
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/agent/ops/tasks',
      expect.anything(),
      '',
    );
  });
  it('hides the previous account task history immediately when the app account changes', async () => {
    let releaseNext!: (value: Response) => void;
    apiFetch.mockImplementation(async (_input, _init, ownerId) => {
      if (ownerId === 'operator-account-b') {
        return await new Promise<Response>((resolve) => { releaseNext = resolve; });
      }
      return { ok: true, json: async () => ({ tasks: [{ id: 'task-a', objective: 'Private task for account A', status: 'completed', createdAt: '2026-11-28T00:00:00.000Z' }] }) } as Response;
    });

    await act(async () => root.render(<OperatorConsole userId="operator-account-a" />));
    await vi.waitFor(() => expect(container.textContent).toContain('Private task for account A'));

    await act(async () => root.render(<OperatorConsole userId="operator-account-b" />));
    expect(container.textContent).not.toContain('Private task for account A');
    expect(container.textContent).toContain('Loading task history');
    expect(container.textContent).toContain('Loading tasks…');

    await act(async () => releaseNext({ ok: true, json: async () => ({ tasks: [{ id: 'task-b', objective: 'Account B task', status: 'queued', createdAt: '2026-11-28T00:01:00.000Z' }] }) } as Response));
    await vi.waitFor(() => expect(container.textContent).toContain('Account B task'));
  });

});
