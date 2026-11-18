import { describe, expect, it, vi } from 'vitest';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';

const event = {
  eventId: '0b6b3c54-2d9a-4e25-8e14-8d4e4b1dfc01',
  eventType: 'tapmap.connection.observed',
  schemaVersion: 1,
  occurredAt: '2026-11-18T12:00:00.000Z',
  source: { provider: 'tapmap' },
  idempotencyKey: 'tapmap:connection:123',
  classification: 'internal' as const,
  payload: { status: 'connected' },
};

describe('EventHandlerRegistry', () => {
  it('dispatches only to an explicitly registered trusted handler', async () => {
    const registry = new EventHandlerRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register(event.eventType, handler);
    await registry.dispatch(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('rejects unknown event types rather than acknowledging them', async () => {
    const registry = new EventHandlerRegistry();
    await expect(registry.dispatch(event)).rejects.toThrow('No trusted handler');
  });

  it('rejects duplicate and malformed registrations', () => {
    const registry = new EventHandlerRegistry();
    registry.register(event.eventType, vi.fn());
    expect(() => registry.register(event.eventType, vi.fn())).toThrow('already registered');
    expect(() => registry.register('../arbitrary', vi.fn())).toThrow('valid event type');
  });

  it('returns a stable list of supported event types', () => {
    const registry = new EventHandlerRegistry();
    registry.register('zeta.observed', vi.fn());
    registry.register('alpha.observed', vi.fn());
    expect(registry.supportedEventTypes()).toEqual(['alpha.observed', 'zeta.observed']);
  });
});
