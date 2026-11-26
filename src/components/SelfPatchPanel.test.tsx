import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SelfPatchPanel from './SelfPatchPanel';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fetchMock = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;
let confirmSpy: ReturnType<typeof vi.spyOn>;

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  confirmSpy.mockRestore();
});

describe('SelfPatchPanel', () => {
  it('requires explicit confirmation before creating a proposal', async () => {
    confirmSpy.mockReturnValue(false);
    await act(async () => root.render(<SelfPatchPanel />));

    const path = container.querySelector('input') as HTMLInputElement;
    const content = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setInputValue(path, 'src/agent/example.ts');
      setInputValue(content, 'export const value = true;');
    });
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toContain('does not merge, deploy');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Creating patch PR');
  });

  it('creates only a PR proposal after explicit confirmation and distinguishes it from CI/review', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        status: 'proposed',
        message: 'Patch proposal created.',
        pullRequestUrl: 'https://github.com/example/repo/pull/1',
        branch: 'self-patch/example',
        commitSha: 'a'.repeat(40),
      },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    await act(async () => root.render(<SelfPatchPanel />));
    const path = container.querySelector('input') as HTMLInputElement;
    const content = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      setInputValue(path, 'src/agent/example.ts');
      setInputValue(content, 'export const value = true;');
    });
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Patch status: PROPOSED');
    expect(container.textContent).toContain('CI/review results are not retrieved by this form');
    expect(container.textContent).toContain('It is not yet merged or deployed');
  });
});
