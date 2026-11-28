// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodingStudio from './CodingStudio';

const auth = vi.hoisted(() => ({ session: { user: { id: 'user-a' } } }));
const api = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: api.authenticatedFetch }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  api.authenticatedFetch.mockImplementation(async (url: string) => {
    if (url === '/api/engineering/jobs') return { ok: true, json: async () => ({ jobs: [] }) };
    if (url === '/api/engineering/studio/native/projects') return { ok: true, json: async () => ({ projects: [] }) };
    if (url === '/api/engineering/studio/overview') return { ok: true, json: async () => ({
      generatedAt: '2026-11-28T08:00:00Z',
      nativeCore: { projectLifecycle: 'ready', scheduler: 'governed', workerRuntime: 'not_enabled', pluginGateway: 'registry', authorizationAuthority: 'Gen-X', productionExecutionEnabled: false },
      execution: { adapterId: 'jarvis', adapterName: 'Jarvis', independentRuntime: false, lifecycleOwner: 'Jarvis', authorizationAuthority: 'Gen-X', state: 'ready', note: 'test' },
      runtime: { state: 'ready', listener: { state: 'ready', connected: true, subscribed: true }, workforce: undefined },
      workforce: { moduleAgents: [], sharedWorkers: [], dispatchAuthority: 'Jarvis', authorizationAuthority: 'Gen-X', note: 'test' },
      integrations: { providers: [], note: 'Canonical registry verified.' },
      projects: [], codingTasks: [],
    }) };
    return { ok: true, json: async () => ({}) };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('RyanAI Studio UI integration', () => {
  it('opens the canonical repository in VS Code Web and does not use the retired repository source', async () => {
    await act(async () => root.render(<CodingStudio />));
    const link = container.querySelector<HTMLAnchorElement>('a[href*="vscode.dev/github/"]');
    expect(link).not.toBeNull();
    expect(link!.href).toContain('vscode.dev/github/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main');
    expect(link!.href).not.toContain('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat');
    expect(container.textContent).toContain('RyanAI Studio');
    expect(container.textContent).toContain('Studio Native Core');
  });

  it('loads the authenticated Studio overview and preserves truthful execution boundaries', async () => {
    await act(async () => root.render(<CodingStudio />));
    await vi.waitFor(() => expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/engineering/studio/overview'));
    expect(container.textContent).toContain('Execution not enabled');
    expect(container.textContent).toContain('No Studio-native projects yet.');
    expect(container.textContent).toContain('No coding tasks have been queued yet.');
  });
});
