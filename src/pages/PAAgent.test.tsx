// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetch } = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('@/components/PADelegationPanel', () => ({ default: () => <div>Delegation panel</div> }));

import PAAgentPage from './PAAgent.js';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function responseFor(url: string, label: string) {
  if (url.endsWith('/pa/status')) return {
    ok: true,
    json: async () => ({ pa: {
      active: true, workState: 'monitoring', lastHeartbeat: new Date().toISOString(),
      lastReport: label, lastError: null, observationsCompleted: 1, retryAttempts: 0,
      health: { api: true, database: true, redis: true, agentCheckpointer: true, agentWorker: true, mcpServer: null, neonAudiobookDatabase: null },
      eBPFPolicyEnforced: false, genXPolicyEngineAvailable: true,
    } }),
  };
  if (url.endsWith('/tasks')) return { ok: true, json: async () => ({ tasks: [] }) };
  return { ok: true, json: async () => ({
    generatedAt: new Date().toISOString(), source: 'test', connectivity: label,
    worker: { state: 'ready', listenerConnected: true, listenerSubscribed: true, lastRecoverySweepAt: null },
    report: { total: 0, executing: 0, queued: 0, waiting: 0, approvalRequired: 0, attentionRequired: 0, completedVerified: 0, offlineBlocked: 0 },
    databaseConnectivity: 'verified',
  }) };
}

describe('PA Agent runtime refresh', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    authenticatedFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports request failures as unverified', async () => {
    authenticatedFetch.mockRejectedValue(new Error('network unavailable'));
    await act(async () => root.render(<PAAgentPage />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('PA status request failed.');
    expect(container.textContent).toContain('Task Awareness request failed; task state remains unverified.');
    expect(container.textContent).toContain('Unverified');
    expect(container.textContent).not.toContain('Connected');
  });

  it('aborts a hung refresh after ten seconds and reports timeout', async () => {
    vi.useFakeTimers();
    authenticatedFetch.mockImplementation((_url: string, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    );
    await act(async () => root.render(<PAAgentPage />));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.textContent).toContain('PA status request timed out.');
    expect(container.textContent).toContain('Task Awareness request timed out; task state remains unverified.');
    expect(container.textContent).toContain('Unverified');
  });

  it('ignores an older refresh that resolves after a newer snapshot', async () => {
    const pending: Array<{ url: string; resolve: (value: ReturnType<typeof responseFor>) => void }> = [];
    let call = 0;
    authenticatedFetch.mockImplementation((url: string) => {
      call += 1;
      if (call <= 3) return new Promise(resolve => pending.push({ url, resolve }));
      return Promise.resolve(responseFor(url, 'new snapshot'));
    });
    await act(async () => root.render(<PAAgentPage />));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('new snapshot');
    await act(async () => {
      pending.forEach(item => item.resolve(responseFor(item.url, 'stale snapshot')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('new snapshot');
    expect(container.textContent).not.toContain('stale snapshot');
  });
});
