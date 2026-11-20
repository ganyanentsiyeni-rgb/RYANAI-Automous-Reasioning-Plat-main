import { describe, expect, it, beforeEach } from 'vitest';
import { EventReplayCursorStore, normalizeEventEnvelope } from './eventReplay';

const event = (id: string, sequence: number) => ({
  id,
  type: 'event' as const,
  channel: 'system.status',
  data: { sequence, state: 'ready' },
  timestamp: 1_700_000_000_000,
});

describe('EventReplayCursorStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts a new event and advances the cursor', () => {
    const store = new EventReplayCursorStore('test');
    const accepted = store.accept(event('evt-1', 7));

    expect(accepted?.data).toEqual({ state: 'ready' });
    expect(store.getCursor()).toEqual({ sequence: 7 });
  });

  it('suppresses duplicate and older events', () => {
    const store = new EventReplayCursorStore('test');
    expect(store.accept(event('evt-1', 7))).not.toBeNull();
    expect(store.accept(event('evt-1', 7))).toBeNull();
    expect(store.accept(event('evt-old', 6))).toBeNull();
    expect(store.accept(event('evt-2', 8))).not.toBeNull();
  });

  it('persists the cursor across client instances', () => {
    const first = new EventReplayCursorStore('persistent');
    first.accept(event('evt-1', 12));

    const second = new EventReplayCursorStore('persistent');
    expect(second.getCursor()).toEqual({ sequence: 12 });
    expect(second.accept(event('evt-1', 12))).toBeNull();
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
