// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import OperatorConsole from './OperatorConsole';
import { listOfflineTasks } from '@/lib/offlineTaskOutbox';

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

  it('does not load account task history without an authenticated account identity', async () => {
    await act(async () => root.render(<OperatorConsole userId="" />));
    await act(async () => await Promise.resolve());
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/agent/ops/tasks',
      expect.anything(),
      '',
    );
  });
});
