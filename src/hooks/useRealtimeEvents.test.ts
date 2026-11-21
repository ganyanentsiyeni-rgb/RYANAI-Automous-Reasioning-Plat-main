import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeEvents } from './useRealtimeEvents';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor() {
    MockWebSocket.instances.push(this);
  }
}

describe('useRealtimeEvents', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: () => 'request-id' });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('subscribes from the persisted decimal cursor and exposes connection state', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => '900719925474099312345'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const { result } = renderHook(() => useRealtimeEvents('tasks.updates', vi.fn()));
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.());

    expect(result.current.connected).toBe(true);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      channel: 'subscribe',
      data: { channel: 'tasks.updates', afterSequence: '900719925474099312345' },
    });
  });

  it('accepts BIGINT-safe decimal sequences and persists the newest cursor', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRealtimeEvents('tasks.updates', onEvent));
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.());

    act(() => socket.onmessage?.({
      data: JSON.stringify({
        id: 'event-1',
        type: 'event',
        channel: 'tasks.updates',
        data: {
          sequence: '900719925474099312345',
          eventType: 'task.updated',
          payload: { taskId: 't1' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        timestamp: 1767225600000,
      }),
    }));

    expect(onEvent).toHaveBeenCalledOnce();
    expect(result.current.cursor).toBe('900719925474099312345');
  });

  it('continues replay pages with nextCursor and does not deliver duplicate older events', () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents('tasks.updates', onEvent));
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.());

    act(() => socket.onmessage?.({
      data: JSON.stringify({
        id: 'replay-response-1',
        type: 'response',
        channel: 'subscribe',
        data: { replayed: 1, hasMore: true, nextCursor: '7' },
        timestamp: 1,
      }),
    }));

    expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({
      channel: 'subscribe',
      data: { channel: 'tasks.updates', afterSequence: '7' },
    });

    act(() => socket.onmessage?.({
      data: JSON.stringify({
        id: 'event-7',
        type: 'event',
        channel: 'tasks.updates',
        data: { sequence: '7', eventType: 'task.updated', payload: {}, createdAt: '2026-01-01T00:00:07.000Z' },
        timestamp: 7,
      }),
    }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('surfaces cursor expiry as resync-required without inventing a replay result', () => {
    const { result } = renderHook(() => useRealtimeEvents('tasks.updates', vi.fn()));
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.());

    act(() => socket.onmessage?.({
      data: JSON.stringify({
        id: 'response-1',
        type: 'response',
        channel: 'subscribe',
        data: { cursorExpired: true, resyncRequired: true, nextCursor: '42' },
        timestamp: 1,
      }),
    }));

    expect(result.current.resyncRequired).toBe(true);
    expect(result.current.cursor).toBe('42');
  });
});
