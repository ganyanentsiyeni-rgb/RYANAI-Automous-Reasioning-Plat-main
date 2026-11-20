import { describe, expect, it, beforeEach } from 'vitest';
import { EventReplayCursorStore, normalizeEventEnvelope } from './eventReplay';

const event = (id: string, sequence: number, channel = 'system.status') => ({
  id,
  type: 'event' as const,
  channel,
  data: { sequence, state: 'ready' },
  timestamp: 1_700_000_000_000,
});

describe('EventReplayCursorStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts a new event and advances only that channel cursor', () => {
    const store = new EventReplayCursorStore('test');
    const accepted = store.accept(event('evt-1', 7));

    expect(accepted?.data).toEqual({ state: 'ready' });
    expect(store.getCursor('system.status')).toEqual({ sequence: 7 });
    expect(store.getCursor('metrics')).toEqual({ sequence: 0 });
  });

  it('suppresses duplicate and older events within the same channel', () => {
    const store = new EventReplayCursorStore('test');
    expect(store.accept(event('evt-1', 7))).not.toBeNull();
    expect(store.accept(event('evt-1', 7))).toBeNull();
    expect(store.accept(event('evt-old', 6))).toBeNull();
    expect(store.accept(event('evt-2', 8))).not.toBeNull();
  });

  it('does not let a busy channel advance another channel cursor', () => {
    const store = new EventReplayCursorStore('interleaved');
    store.accept(event('metrics-40', 40, 'metrics'));
    store.accept(event('status-4', 4, 'system.status'));

    expect(store.getCursor('metrics')).toEqual({ sequence: 40 });
    expect(store.getCursor('system.status')).toEqual({ sequence: 4 });
    expect(store.accept(event('status-5', 5, 'system.status'))).not.toBeNull();
  });

  it('persists independent channel cursors across client instances', () => {
    const first = new EventReplayCursorStore('persistent');
    first.accept(event('evt-1', 12, 'system.status'));
    first.accept(event('evt-2', 90, 'metrics'));

    const second = new EventReplayCursorStore('persistent');
    expect(second.getCursor('system.status')).toEqual({ sequence: 12 });
    expect(second.getCursor('metrics')).toEqual({ sequence: 90 });
    expect(second.accept(event('evt-1', 12, 'system.status'))).toBeNull();
  });

  it('does not trust a legacy global cursor as a per-channel cursor', () => {
    localStorage.setItem('ryanai:event-cursor:legacy', '500');
    const store = new EventReplayCursorStore('legacy');
    expect(store.getCursor('system.status')).toEqual({ sequence: 0 });
    expect(store.accept(event('evt-1', 1))).not.toBeNull();
  });

  it('normalizes sequence metadata without leaking it to handlers', () => {
    const normalized = normalizeEventEnvelope(event('evt-9', 19));
    expect(normalized).toEqual({
      id: 'evt-9',
      sequence: 19,
      channel: 'system.status',
      data: { state: 'ready' },
      timestamp: 1_700_000_000_000,
    });
  });
});
