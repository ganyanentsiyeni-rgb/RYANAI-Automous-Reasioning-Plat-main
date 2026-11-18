import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { IntelligenceEventInbox } from './intelligenceEventInbox.js';
import { EventHandlerRegistry } from './eventHandlerRegistry.js';

export interface EventWorkerOptions {
  pollIntervalMs?: number;
  workerId?: string;
  onError?: (error: unknown) => void;
}

/**
 * Starts a supervised polling loop only when at least one trusted handler is
 * registered. No handler means no claims, not retries or silent acknowledgements.
 */
export function startIntelligenceEventWorker(
  db: PrismaClient,
  registry: EventHandlerRegistry,
  options: EventWorkerOptions = {},
): (() => void) | null {
  if (registry.size === 0) return null;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    throw new RangeError('pollIntervalMs must be an integer between 100 and 60000.');
  }

  const inbox = new IntelligenceEventInbox(db);
  const workerId = options.workerId?.trim() || `event-worker-${randomUUID()}`;
  const eventTypes = registry.supportedEventTypes();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => { void tick(); }, delay);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    let delay = pollIntervalMs;
    try {
      const result = await inbox.processNext(workerId, (event) => registry.dispatch(event), new Date(), eventTypes);
      if (result.status !== 'idle') delay = 0;
    } catch (error) {
      options.onError?.(error);
      delay = Math.min(pollIntervalMs * 2, 30_000);
    } finally {
      running = false;
      schedule(delay);
    }
  };

  schedule(0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
