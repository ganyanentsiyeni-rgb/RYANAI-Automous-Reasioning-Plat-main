// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RyanAIClient } from './client';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  static instances: MockWebSocket[] = [];
}

describe('RyanAIClient transport continuity', () => {
  const clients: RyanAIClient[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    // Reconnect delay includes jitter; keep timer assertions deterministic.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    // Always remove browser listeners, including when an assertion fails.
    for (const client of clients.splice(0)) client.destroy();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('restores live subscriptions after a reconnect without replaying requests', async () => {
    const client = new RyanAIClient({
      url: 'ws://example.test/ws',
      reconnectInterval: 250,
      maxReconnectAttempts: 2,
      maxReconnectDelay: 250,
    });

    clients.push(client);
    const handler = vi.fn();
    client.on('metrics', handler);

    const firstConnect = client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    await firstConnect;

    expect(client.connectionState.value).toBe('connected');
    expect(first.send).toHaveBeenCalledWith(expect.stringContaining('"channel":"subscribe"'));

    first.receive({
      id: 'event-1',
      type: 'event',
      channel: 'metrics',
      data: { cpu: 10 },
      timestamp: Date.now(),
    });
    expect(handler).toHaveBeenCalledWith({ cpu: 10 });

    first.close();
    expect(client.connectionState.value).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(250);
    const second = MockWebSocket.instances[1];
    expect(second).toBeDefined();
    second.open();

    expect(client.connectionState.value).toBe('connected');
    expect(second.send).toHaveBeenCalledWith(expect.stringContaining('"channel":"subscribe"'));

    // An in-flight request is never replayed automatically after transport loss.
    expect(second.send.mock.calls.filter((call) => String(call[0]).includes('"type":"request"')).length).toBe(1);

    client.destroy();
  });

  it('moves to offline state and waits for browser connectivity before reconnecting', async () => {
    const client = new RyanAIClient({
      url: 'ws://example.test/ws',
      reconnectInterval: 100,
      maxReconnectAttempts: 2,
    });

    clients.push(client);
    const connection = client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    await connection;

    // Closing while online schedules a retry. Going offline must cancel it.
    first.close();
    expect(client.connectionState.value).toBe('reconnecting');
    window.dispatchEvent(new Event('offline'));
    expect(client.connectionState.value).toBe('offline');

    await vi.advanceTimersByTimeAsync(500);
    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveLength(2);

    client.destroy();
  });

  it('does not reconnect after an explicit disconnect', async () => {
    const client = new RyanAIClient({
      url: 'ws://example.test/ws',
      reconnectInterval: 100,
      maxReconnectAttempts: 2,
    });

    clients.push(client);
    const connection = client.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    await connection;

    client.disconnect();
    await vi.advanceTimersByTimeAsync(500);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.connectionState.value).toBe('disconnected');

    client.destroy();
  });
});
