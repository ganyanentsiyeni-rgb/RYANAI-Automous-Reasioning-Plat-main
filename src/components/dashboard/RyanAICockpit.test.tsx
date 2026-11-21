// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import RyanAICockpit from './RyanAICockpit';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: () => ({
    health: { status: 'online', services: { database: true, redis: true }, timestamp: '2026-11-08T16:00:00.000Z' },
    error: null,
    checking: false,
    refresh: vi.fn(),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const api = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  api.mockResolvedValue(new Response(JSON.stringify({
    brains: [], timestamp: '2026-11-08T16:00:00.000Z',
  }), { status: 200 }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('RyanAI Cockpit account boundary', () => {
  it('binds provider health requests to the authenticated account', async () => {
    await act(async () => root.render(<RyanAICockpit userId="synthetic-user-a" />));
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent/ops/brains'),
      expect.objectContaining({ method: 'GET' }),
      'synthetic-user-a',
    ));
  });

  it('loads owner-scoped persisted runs and worker awareness for the live operation panel', async () => {
    await act(async () => root.render(<RyanAICockpit userId="synthetic-user-a" />));
    await vi.waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        expect.stringContaining('/api/agent/ops/tasks'),
        expect.objectContaining({ method: 'GET' }),
        'synthetic-user-a',
      );
      expect(api).toHaveBeenCalledWith(
        expect.stringContaining('/api/agent/ops/awareness'),
        expect.objectContaining({ method: 'GET' }),
        'synthetic-user-a',
      );
    });
  });
});
