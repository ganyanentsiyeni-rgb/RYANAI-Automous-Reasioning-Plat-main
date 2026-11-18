// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './Dashboard';

const hoisted = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: () => hoisted.value,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MOUNTED_AT = Date.parse('2026-11-07T19:30:00.000Z');
const FUTURE_BANNER = 'The API returned a missing, invalid or future timestamp';

let container: HTMLDivElement;
let root: Root;

function healthState(timestampMs: number, receivedAtMs: number) {
  return {
    health: {
      status: 'online',
      timestamp: new Date(timestampMs).toISOString(),
      services: { database: true, redis: true, agentCheckpointer: true },
    },
    receivedAt: receivedAtMs,
    error: null,
    checking: false,
    refresh: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MOUNTED_AT);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'PA observer unavailable in this test.' }),
  }));
  hoisted.value = { health: null, receivedAt: null, error: null, checking: true, refresh: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mountThenReceiveHealth(timestampMs: number, receivedAtMs: number) {
  await act(async () => {
    root.render(<DashboardPage />);
  });
  // The page clock is set at mount and ticks every 15 seconds. The health
  // response arrives between ticks, so its server timestamp is newer than the
  // page clock even when the browser and server clocks agree.
  vi.setSystemTime(receivedAtMs);
  hoisted.value = healthState(timestampMs, receivedAtMs);
  await act(async () => {
    root.render(<DashboardPage />);
  });
}

describe('System Dashboard health freshness', () => {
  it('treats a health response that arrives between clock ticks as current', async () => {
    await mountThenReceiveHealth(MOUNTED_AT + 300, MOUNTED_AT + 400);

    expect(container.textContent).not.toContain(FUTURE_BANNER);
    expect(container.textContent).toContain('Health signal updated');
  });

  it('still reports a timestamp that is ahead of the moment it was received', async () => {
    await mountThenReceiveHealth(MOUNTED_AT + 60_000, MOUNTED_AT + 400);

    expect(container.textContent).toContain(FUTURE_BANNER);
  });

  it('marks the retained last-known health snapshot unverified after a failed refresh', async () => {
    await mountThenReceiveHealth(MOUNTED_AT + 300, MOUNTED_AT + 400);
    hoisted.value = { ...(hoisted.value as ReturnType<typeof healthState>), error: 'API health check timed out.' };
    await act(async () => {
      root.render(<DashboardPage />);
    });

    expect(container.textContent).toContain('latest refresh failed');
    expect(container.textContent).toContain('API health check timed out.');
    expect(container.textContent).toContain('The health snapshot is stale or its latest refresh failed.');
  });
});
