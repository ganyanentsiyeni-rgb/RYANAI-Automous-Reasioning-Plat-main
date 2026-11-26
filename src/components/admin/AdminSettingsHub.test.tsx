// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import AdminSettingsHub from './AdminSettingsHub';
import { useRyanOperations } from '@/hooks/useRyanOperations';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/hooks/useRyanOperations', () => ({ useRyanOperations: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const apiFetch = vi.mocked(authenticatedFetch);
const operations = vi.mocked(useRyanOperations);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  operations.mockReturnValue({ tasks: [], loading: false, error: null, lastConfirmedAt: null, refresh: vi.fn(), refreshing: false } as unknown as ReturnType<typeof useRyanOperations>);
  apiFetch.mockResolvedValue(new Response(JSON.stringify({ providers: [] }), { status: 200 }));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('AdminSettingsHub directory', () => {
  it('lists all twelve workspace and control destinations and loads the authenticated capability catalogue', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<AdminSettingsHub userId="verified-user" />));
    expect(container.querySelectorAll('[data-testid="workspace-area-link"]')).toHaveLength(12);
    expect(container.textContent).toContain('12 product areas');
    expect(container.textContent).toContain('Settings & workspace control');
    await vi.waitFor(() => expect(container.textContent).toContain('confirmed an empty provider catalogue'));
    expect(apiFetch).toHaveBeenCalledWith('/api/plugins/registry', expect.objectContaining({ method: 'GET' }), 'verified-user');
  });
});
