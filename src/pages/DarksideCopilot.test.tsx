// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DarksideCopilot from './DarksideCopilot';

const authenticatedFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('@/pages/CommandCenter.tsx', () => ({ default: () => <div data-testid="command-center" /> }));
vi.mock('@/components/PADelegationPanel', () => ({ default: () => <div data-testid="delegation-panel" /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

const baseProps = {
  onSignOut: vi.fn(),
  userId: 'user-a',
  voiceSettings: { realtimeVoice: 'ash' as const, anniversaryEvolution: true },
  copilotSettings: { showAlexStatus: true, showDelegationPanel: true, refreshIntervalSeconds: 30 as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticatedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ pa: { active: true, workState: 'monitoring', health: { api: true, database: true, redis: true } } }),
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

describe('Ryan Copilot preferences', () => {
  it('keeps the shared PA control plane linked even when optional Copilot panels are hidden', async () => {
    await act(async () => root.render(
      <DarksideCopilot {...baseProps} copilotSettings={{ showAlexStatus: false, showDelegationPanel: false, refreshIntervalSeconds: 60 }} />,
    ));
    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="delegation-panel"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Alex · PA Agent');
    expect(container.querySelector('[data-testid="command-center"]')).not.toBeNull();
  });

  it('uses the saved refresh interval and displays enabled status and delegation surfaces', async () => {
    const interval = vi.spyOn(window, 'setInterval').mockReturnValue(123 as unknown as number);
    await act(async () => root.render(
      <DarksideCopilot {...baseProps} copilotSettings={{ showAlexStatus: true, showDelegationPanel: true, refreshIntervalSeconds: 60 }} />,
    ));
    await vi.waitFor(() => expect(authenticatedFetch).toHaveBeenCalledOnce());
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(container.textContent).toContain('Alex · Monitoring');
    expect(container.querySelectorAll('[data-testid="delegation-panel"]')).toHaveLength(1);
  });
});
