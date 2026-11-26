// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import GithubModal from './GithubModal';
vi.mock('framer-motion', async () => {
  const React = await import('react');
  type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
  };
  const StaticMotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(
    ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }),
  );
  return { motion: { div: StaticMotionDiv } };
});

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true, status = ok ? 200 : 503) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mount() {
  await act(async () => root.render(<GithubModal open onClose={vi.fn()} />));
}

async function click(button: Element | null) {
  if (!button) throw new Error('Expected button was not found.');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

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

describe('GitHub App integration modal', () => {
  it('keeps connection disabled until server-side App configuration exists', async () => {
    api.mockResolvedValueOnce(response({ status: 'not_configured', connected: false }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Not configured'));
    expect(container.textContent).toContain('Register a GitHub App');
    const connect = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Connect GitHub'));
    expect(connect).not.toBeNull();
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/github/status');
  });

  it('keeps local disconnect available when GitHub App configuration is unavailable', async () => {
    api.mockResolvedValueOnce(response({
      status: 'configuration_unavailable',
      connected: false,
      persistedConnection: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat' },
    }));
    api.mockResolvedValueOnce(response({ disconnected: true, remoteRevocation: 'unconfirmed' }));
    api.mockResolvedValueOnce(response({ status: 'not_configured', connected: false }));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Configuration unavailable'));
    expect(container.textContent).toContain('saved local connection still exists');
    const disconnect = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Disconnect GitHub'));
    expect(disconnect).not.toBeNull();
    await click(disconnect ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Remote revocation could not be confirmed'));
    expect(api).toHaveBeenCalledWith('/api/github/disconnect', { method: 'POST' });
  });

  it('shows only server-verified account and official repository status', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: {
        fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat',
        permissions: { pull: true, push: false },
      },
      accessTokenExpiresAt: '2026-11-05T20:00:00.000Z',
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    expect(container.textContent).toContain('synthetic-owner');
    expect(container.textContent).toContain('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat');
    expect(container.textContent).toContain('does not implement pushes');
    expect(container.textContent).not.toContain('ghu.');
    expect(container.textContent).not.toContain('ghr.');
  });

  it('shows privacy-safe review provenance and keeps Copilot separate from human approval', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat', permissions: { pull: true } },
    }));
    api.mockResolvedValueOnce(response({
      status: 'available',
      pullRequestNumber: 1330,
      headSha: 'a'.repeat(40),
      complete: true,
      returnedReviewCount: 1,
      reportedReviewCount: 1,
      copilotReviewCount: 1,
      exactHeadHumanApprovalCount: 0,
      reviews: [{
        reviewId: 'review-1',
        state: 'COMMENTED',
        actorKind: 'copilot',
        reviewedCommitSha: 'a'.repeat(40),
        submittedAt: '2026-11-08T09:00:00.000Z',
        effortLevel: 'balanced',
        commentAttributions: [{ commentId: 'comment-1', sourceKinds: ['mcp', 'skill'] }],
      }],
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    const input = container.querySelector('#github-review-pr-number') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '1330');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Inspect')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Copilot review'));
    expect(container.textContent).toContain('Exact-head human approvals');
    expect(container.textContent).toContain('Sources: mcp, skill');
    expect(container.textContent).toContain('Copilot reviews are advisory only');
    expect(api).toHaveBeenCalledWith('/api/github/pull-requests/1330/review-provenance', { headers: { Accept: 'application/json' } });
  });

  it('removes the local connection and warns when remote token revocation cannot be confirmed', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat', permissions: { pull: true } },
    }));
    api.mockResolvedValueOnce(response({ disconnected: true, remoteRevocation: 'unconfirmed' }));
    api.mockResolvedValueOnce(response({ status: 'not_connected', connected: false, configured: true }));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    await click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Disconnect GitHub')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Remote revocation could not be confirmed'));
    expect(api).toHaveBeenCalledWith('/api/github/disconnect', { method: 'POST' });
    expect(container.textContent).toContain('Not connected');
  });

  it('shows a pending state while refreshing an already-loaded connection', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat' },
    }));
    let resolveRefresh!: (value: Response) => void;
    api.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    }));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    const refresh = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Refresh status'));
    await click(refresh ?? null);
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(refresh?.textContent).toContain('Checking…');

    await act(async () => resolveRefresh(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat' },
    })));
    await vi.waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  });

});
