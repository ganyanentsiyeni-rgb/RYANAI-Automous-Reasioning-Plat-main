// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BasicProgrammingToolsPage from './BasicProgrammingTools';

const api = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: api.authenticatedFetch }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => root.render(<BasicProgrammingToolsPage />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!button) throw new Error('Button not found: ' + label);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.authenticatedFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => url === '/api/engineering/studio/native/projects' ? { projects: [] } : {},
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Basic Programming Tools project containers', () => {
  it('loads persisted project containers from the authenticated Studio API', async () => {
    api.authenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [{
        id: 'project-1', title: 'API lifecycle', objective: 'Validate API worker leases',
        projectType: 'engineering', status: 'queued', createdAt: '2026-11-19T00:00:00Z', tasks: [],
      }] }),
    });
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('API lifecycle'));
    expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/engineering/studio/native/projects');
  });

  it('switches to the independent Research container and shows research records only', async () => {
    api.authenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [
        { id: 'p1', title: 'Coding work', objective: 'Build UI', projectType: 'engineering', status: 'queued', createdAt: '2026-11-19T00:00:00Z', tasks: [] },
        { id: 'p2', title: 'Research work', objective: 'Compare worker patterns', projectType: 'research', status: 'completed', createdAt: '2026-11-19T00:00:00Z', tasks: [] },
      ] }),
    });
    await mount();
    await click('Research');
    expect(container.textContent).toContain('Research work');
    expect(container.textContent).not.toContain('Coding work');
  });

  it('filters pending and completed containers by lifecycle status', async () => {
    api.authenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [
        { id: 'pending-1', title: 'Pending coding task', objective: 'Build feature', projectType: 'engineering', status: 'queued', createdAt: '2026-11-19T00:00:00Z', tasks: [] },
        { id: 'done-1', title: 'Completed coding task', objective: 'Ship tests', projectType: 'engineering', status: 'completed', createdAt: '2026-11-18T00:00:00Z', tasks: [] },
      ] }),
    });
    await mount();
    expect(container.textContent).toContain('Pending coding task');
    expect(container.textContent).toContain('Completed coding task');
    const filter = container.querySelector('[aria-label="Filter project status"]') as HTMLSelectElement;
    await act(async () => {
      filter.value = 'completed';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Completed coding task');
    expect(container.textContent).not.toContain('Pending coding task');
  });

  it('creates a durable coding container with a queued planning task', async () => {
    api.authenticatedFetch.mockImplementation(async (_url: string, options?: RequestInit) => ({
      ok: true,
      json: async () => options?.method === 'POST' ? { project: { id: 'new-project' } } : { projects: [] },
    }));
    await mount();
    const fields = container.querySelectorAll('input, textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(fields[0], 'Worker recovery');
      fields[0].dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(fields[1], 'Implement lease recovery and tests');
      fields[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Create container');
    await vi.waitFor(() => expect(api.authenticatedFetch).toHaveBeenCalledWith('/api/engineering/studio/native/projects', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"projectType":"engineering"'),
    })));
  });
});
