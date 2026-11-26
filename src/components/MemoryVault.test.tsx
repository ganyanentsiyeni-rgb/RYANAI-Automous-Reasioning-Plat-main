// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import MemoryVault from './MemoryVault';

// happy-dom cannot reliably cancel Framer Motion animations during unmount.
// This suite verifies Memory Vault behavior, not animation timelines.
vi.mock('framer-motion', () => import('../test/mocks/framerMotion'));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.mocked(authenticatedFetch);
const entry = {
  id: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11',
  key: 'vault_test',
  value: 'Prefer concise project summaries.',
  category: 'preference',
  createdAt: '2026-11-05T10:00:00.000Z',
};
const secondEntry = {
  ...entry,
  id: '8b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c12',
  value: 'Keep engineering notes searchable.',
};
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

async function mount(open = true, userId = 'user-a') {
  await act(async () => root.render(<MemoryVault open={open} userId={userId} onClose={vi.fn()} />));
}

async function click(button: Element | null) {
  if (!button) throw new Error('Expected button was not found.');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function setTextValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    if (path === '/api/user/memory' && (!init?.method || init.method === 'GET')) {
      return response({ entries: [entry], limit: 50, hasMore: false, nextCursor: null });
    }
    if (path === '/api/user/memory' && init?.method === 'POST') {
      return response({ entry: { ...entry, value: JSON.parse(String(init.body)).value } }, true);
    }
    if (path === '/api/user/memory/' + entry.id && init?.method === 'PUT') {
      return response({ entry: { ...entry, value: JSON.parse(String(init.body)).value } });
    }
    if (path === '/api/user/memory/' + entry.id && init?.method === 'DELETE') {
      return response({ deleted: true, id: entry.id });
    }
    throw new Error('Unexpected memory API request: ' + path + ' ' + init?.method);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('persistent Memory Vault', () => {
  it('loads entries from the authenticated shared memory API when opened', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    expect(api).toHaveBeenCalledWith('/api/user/memory?limit=50', expect.objectContaining({ headers: { Accept: 'application/json' } }), 'user-a');
    expect(container.textContent).toContain('same store');
  });

  it('reloads memories with the new account identity when the authenticated user changes', async () => {
    const accountAEntry = { ...entry, value: 'Account A private memory.' };
    const accountBEntry = { ...entry, value: 'Account B private memory.' };
    api.mockImplementation(async (input, init, requestUserId) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/user/memory' && (!init?.method || init.method === 'GET')) {
        return response({
          entries: [requestUserId === 'user-b' ? accountBEntry : accountAEntry],
          limit: 50,
          hasMore: false,
          nextCursor: null,
        });
      }
      throw new Error('Unexpected memory API request: ' + url.pathname + ' ' + init?.method);
    });

    await mount(true, 'user-a');
    await vi.waitFor(() => expect(container.textContent).toContain(accountAEntry.value));

    await mount(true, 'user-b');
    await vi.waitFor(() => expect(container.textContent).toContain(accountBEntry.value));

    expect(api).toHaveBeenNthCalledWith(
      2,
      '/api/user/memory?limit=50',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
      'user-b',
    );
    expect(container.textContent).not.toContain(accountAEntry.value);
  });

  it('creates a memory through the shared Postgres API', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    const textarea = container.querySelector('#memory-new-content') as HTMLTextAreaElement;
    await setTextValue(textarea, 'Remember the release checklist.');
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save memory')) ?? null);
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory', expect.objectContaining({ method: 'POST' }), 'user-a'));
  });

  it('edits an existing memory using its account-scoped endpoint', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Edit memory"]'));
    const textarea = container.querySelector('textarea[aria-label="Edit memory content"]') as HTMLTextAreaElement;
    await setTextValue(textarea, 'Updated project preference.');
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save changes')) ?? null);
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory/' + entry.id, expect.objectContaining({ method: 'PUT' }), 'user-a'));
  });

  it('deletes an existing memory through the shared Postgres API', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Delete memory"]'));
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory/' + entry.id, expect.objectContaining({ method: 'DELETE' }), 'user-a'));
  });

  it('searches the current account memories using the requested query', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    const search = container.querySelector('#memory-search') as HTMLInputElement;
    await setTextValue(search, 'project');
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Search') ?? null);
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/user/memory?q=project&limit=50',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
      'user-a',
    ));
  });

  it('loads the next memory page without replacing the current page', async () => {
    api.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/user/memory' && (!init?.method || init.method === 'GET')) {
        return url.searchParams.has('cursor')
          ? response({ entries: [secondEntry], limit: 50, hasMore: false, nextCursor: null })
          : response({ entries: [entry], limit: 50, hasMore: true, nextCursor: entry.id });
      }
      throw new Error('Unexpected memory API request: ' + url.pathname + ' ' + init?.method);
    });
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Load more memories')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain(secondEntry.value));
    expect(container.textContent).toContain(entry.value);
    expect(api).toHaveBeenCalledWith(
      '/api/user/memory?cursor=' + entry.id + '&limit=50',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
      'user-a',
    );
  });

  it('disables pagination and shows progress while the next page is loading', async () => {
    let resolvePage: ((value: Response) => void) | undefined;
    api.mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/user/memory' && url.searchParams.has('cursor')) {
        return await new Promise<Response>((resolve) => { resolvePage = resolve; });
      }
      return response({ entries: [entry], limit: 50, hasMore: true, nextCursor: entry.id });
    });

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Load more memories')) ?? null);

    const loadingButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Loading…'));
    expect(loadingButton).toBeTruthy();
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);

    await act(async () => resolvePage?.(response({ entries: [secondEntry], limit: 50, hasMore: false, nextCursor: null })));
    await vi.waitFor(() => expect(container.textContent).toContain(secondEntry.value));
  });

  it('shows API failures instead of pretending a memory was saved', async () => {
    api.mockRejectedValueOnce(new Error('Private memory storage is unavailable.'));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Private memory storage is unavailable.'));
  });
});
