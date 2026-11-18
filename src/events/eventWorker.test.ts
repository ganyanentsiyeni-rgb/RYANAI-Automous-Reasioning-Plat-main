import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';
import { startIntelligenceEventWorker } from './eventWorker.js';

describe('startIntelligenceEventWorker', () => {
  it('does not start or claim events when no trusted handler is registered', () => {
    const registry = new EventHandlerRegistry();
    const stop = startIntelligenceEventWorker({} as PrismaClient, registry);
    expect(stop).toBeNull();
  });

  it('validates the polling interval before starting', () => {
    const registry = new EventHandlerRegistry();
    registry.register('safe.event', vi.fn());
    expect(() => startIntelligenceEventWorker({} as PrismaClient, registry, { pollIntervalMs: 1 })).toThrow();
  });
});
