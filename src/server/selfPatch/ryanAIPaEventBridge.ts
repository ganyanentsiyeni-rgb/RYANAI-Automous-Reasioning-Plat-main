import { EventEmitter } from 'node:events';
import type { RyanAIEvent } from './ryanAIEventContract.js';

/**
 * In-process, RyanAI-only PA observation bus.
 * Consumers receive validated metadata only; this bridge grants no capabilities.
 */
class RyanAIPaEventBridge extends EventEmitter {
  publish(event: RyanAIEvent): void {
    this.emit('event', event);
  }
}

export const ryanAIPaEventBridge = new RyanAIPaEventBridge();
