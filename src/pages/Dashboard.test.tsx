// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './Dashboard';

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: () => ({
    health: null,
    error: null,
    checking: false,
    refresh: vi.fn(),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'PA observer unavailable in this test.' }),
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderDashboard(isOwner = false, isAdmin = false, enabledModules?: Record<string, boolean>) {
  await act(async () => {
    root.render(<DashboardPage isOwner={isOwner} isAdmin={isAdmin} enabledModules={enabledModules} />);
  });
}

describe('System Dashboard workspace launcher', () => {
  it('links to each regular-account workspace', async () => {
    await renderDashboard();

    expect(container.textContent).toContain('Platform workspaces');
    expect(container.textContent).toContain('Music player');
    expect(container.textContent).toContain('Your music library is empty');
    for (const [path, label] of [
      ['#/pa', 'Personal Assistant'],
      ['#/cockpit', 'Command Cockpit'],
      ['#/operator', 'Operator Console'],
      ['#/operations', 'Operations Center'],
      ['#/settings', 'Settings'],
      ['#/programming', 'Basic Programming Tools'],
      ['#/quant', 'Quant Lab'],
      ['#/trading', 'Trading Terminal'],
      ['#/workspace', 'Reasoning Workspace'],
      ['#/phonelink', 'RyanAI PhoneLink'],
      ['#/music', 'RyanAI Music'],
      ['#/studio', 'RyanAI Studio'],
    ]) {
      const link = container.querySelector(`a[href="${path}"]`);
      expect(link?.textContent).toContain(label);
    }
    expect(container.querySelector('a[href="#/comms"]')).toBeNull();
    expect(container.querySelector('a[href="#/admin"]')).toBeNull();
  });

  it('keeps Settings visible while filtering disabled workspace cards', async () => {
    await renderDashboard(false, false, { pa: true, workspace: true, cockpit: false, programming: false });

    expect(container.querySelector('a[href="#/pa"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/workspace"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/settings"]')?.textContent).toContain('Settings');
    expect(container.querySelector('a[href="#/cockpit"]')).toBeNull();
    expect(container.querySelector('a[href="#/programming"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/audiobook"]')).toBeNull();
  });

  it('keeps the requested fourteen-option dashboard contract free of legacy audiobook shortcuts', async () => {
    await renderDashboard(true, true);
    for (const path of ['/pa', '/operator', '/operations', '/admin', '/quant', '/trading', '/cockpit', '/studio', '/programming', '/comms', '/workspace', '/music', '/phonelink']) {
      expect(container.querySelector(`a[href="#${path}"]`), `expected workspace link ${path}`).not.toBeNull();
    }
    expect(container.querySelector('a[href="#/audiobook"]')).toBeNull();
    expect(container.querySelector('a[href="#/settings"]')).not.toBeNull();
  });

  it('adds the Admin Console only for an administrator session', async () => {
    await renderDashboard(false, true);
    const adminLink = container.querySelector('a[href="#/admin"]');
    expect(adminLink?.textContent).toContain('Admin Console');
  });

  it('adds RyanAI Comms only for an owner session', async () => {
    await renderDashboard(true);

    const commsLink = container.querySelector('a[href="#/comms"]');
    expect(commsLink?.textContent).toContain('RyanAI Comms');
  });
});
