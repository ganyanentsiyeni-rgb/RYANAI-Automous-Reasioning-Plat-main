// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import PluginCapabilityCatalog from './PluginCapabilityCatalog';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const apiFetch = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;
const provider = {
  id: 'google-calendar',
  displayName: 'Google Calendar',
  version: '1.0.0',
  categories: ['workflows'],
  description: 'Calendar integration metadata.',
  capabilities: [{ id: 'events.read', risk: 'read', requiresHumanApproval: false }, { id: 'events.create', risk: 'write', requiresHumanApproval: true }],
  dataClassifications: ['personal_data'],
  adapterStatus: 'adapter_required',
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('PluginCapabilityCatalog', () => {
  it('renders the authenticated backend manifest without treating it as connection or permission state', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ providers: [provider] }), { status: 200 }));
    await act(async () => root.render(<PluginCapabilityCatalog userId="verified-user" />));
    await vi.waitFor(() => expect(container.textContent).toContain('Google Calendar'));
    expect(apiFetch).toHaveBeenCalledWith('/api/plugins/registry', expect.objectContaining({ method: 'GET' }), 'verified-user');
    expect(container.textContent).toContain('events.read');
    expect(container.textContent).toContain('human approval required');
    expect(container.textContent).toContain('Adapter required');
    expect(container.textContent).toContain('not user permissions');
    expect(container.textContent).not.toContain('Connected');
    expect(container.textContent).not.toContain('Healthy');
  });

  it('fails visibly when the registry response violates its contract', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ providers: [{ id: 'broken' }] }), { status: 200 }));
    await act(async () => root.render(<PluginCapabilityCatalog userId="verified-user" />));
    await vi.waitFor(() => expect(container.textContent).toContain('invalid plugin registry contract'));
  });

  it('does not fabricate an empty catalogue when the API is unavailable', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
    await act(async () => root.render(<PluginCapabilityCatalog userId="verified-user" />));
    await vi.waitFor(() => expect(container.textContent).toContain('HTTP 403'));
    expect(container.textContent).not.toContain('confirmed an empty provider catalogue');
  });
});
