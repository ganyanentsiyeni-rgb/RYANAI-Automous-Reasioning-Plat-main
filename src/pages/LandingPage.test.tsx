// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import LandingPage from './LandingPage';

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function setHealthState(state: {
  health: { status: string } | null;
  error: string | null;
  checking: boolean;
}) {
  vi.mocked(usePlatformHealth).mockReturnValue({
    ...state,
    receivedAt: null,
    refresh: vi.fn(),
  } as never);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('Landing Page', () => {
  it('shows the connected state and all primary workspace destinations', async () => {
    setHealthState({ health: { status: 'online' }, error: null, checking: false });

    await act(async () => root.render(<LandingPage />));

    expect(container.textContent).toContain('RyanAI API connected');
    expect(container.querySelector('a[href="#/workspace"]')?.textContent).toContain('Open reasoning workspace');
    expect(container.querySelector('a[href="#/dashboard"]')?.textContent).toContain('View live dashboard');
    expect(container.querySelector('a[href="#/cockpit"]')).not.toBeNull();
  });

  it('communicates that the API check is still in progress', async () => {
    setHealthState({ health: null, error: null, checking: true });

    await act(async () => root.render(<LandingPage />));

    expect(container.textContent).toContain('Checking API connection');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('exposes the API failure and setup guidance without hiding workspace navigation', async () => {
    setHealthState({
      health: null,
      error: 'API health request failed',
      checking: false,
    });

    await act(async () => root.render(<LandingPage />));

    expect(container.textContent).toContain('API unavailable');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('API health request failed');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('VITE_API_BASE_URL');
    expect(container.querySelector('a[href="#/workspace"]')).not.toBeNull();
  });
});
