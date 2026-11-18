import type { RyanAIEventEnvelope } from './eventContract.js';
import type { EventHandler } from './intelligenceEventInbox.js';

/**
 * Trusted, server-owned event handler registry. Provider payloads never choose
 * a module, function, URL, or tool; dispatch is limited to explicitly registered
 * event types.
 */
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();

  register(eventType: string, handler: EventHandler): void {
    const normalized = eventType.trim();
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized) || normalized.length > 160) {
      throw new TypeError('A valid event type is required.');
    }
    if (this.handlers.has(normalized)) throw new Error(`A handler is already registered for ${normalized}.`);
    this.handlers.set(normalized, handler);
  }

  supportedEventTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }

  async dispatch(event: RyanAIEventEnvelope): Promise<void> {
    const handler = this.handlers.get(event.eventType);
    if (!handler) throw new Error(`No trusted handler is registered for event type: ${event.eventType}`);
    await handler(event);
  }

  get size(): number {
    return this.handlers.size;
  }
}
