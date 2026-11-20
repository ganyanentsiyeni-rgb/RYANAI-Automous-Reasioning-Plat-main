import type { WebSocketMessage } from './types.js';

export interface DurableEventEnvelope {
  id: string;
  sequence: number;
  channel: string;
  data: unknown;
  timestamp: number;
}

export interface EventReplayCursor {
  sequence: number;
}

export function normalizeEventEnvelope(message: WebSocketMessage): DurableEventEnvelope | null {
  if (message.type !== 'event' && message.type !== 'stream') return null;
  if (!message.id || !message.channel || !Number.isFinite(message.timestamp)) return null;

  const raw = message.data;
  const sequence =
    typeof raw === 'object' && raw !== null && 'sequence' in raw && Number.isSafeInteger(Number(raw.sequence)) && Number(raw.sequence) >= 0
      ? Number(raw.sequence)
      : 0;

  const data =
    typeof raw === 'object' && raw !== null && 'sequence' in raw
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'sequence'))
      : raw;

  return { id: message.id, sequence, channel: message.channel, data, timestamp: message.timestamp };
}

/**
 * Per-channel durable event cursors. A single global cursor is unsafe when
 * independently subscribed channels emit at different rates: progress on one
 * channel could otherwise skip unseen events on another channel.
 */
export class EventReplayCursorStore {
  private readonly storageKey: string;
  private readonly seenKey: string;
  private sequences = new Map<string, number>();
  private seen = new Set<string>();

  constructor(namespace = 'default') {
    this.storageKey = `ryanai:event-cursor:${namespace}`;
    this.seenKey = `ryanai:event-seen:${namespace}`;
    this.load();
  }

  public getCursor(channel: string): EventReplayCursor {
    return { sequence: this.sequences.get(channel) ?? 0 };
  }

  public accept(message: WebSocketMessage): DurableEventEnvelope | null {
    const event = normalizeEventEnvelope(message);
    if (!event || this.seen.has(event.id)) return null;

    const currentSequence = this.sequences.get(event.channel) ?? 0;
    if (event.sequence > 0 && event.sequence < currentSequence) return null;

    this.seen.add(event.id);
    if (event.sequence > currentSequence) this.sequences.set(event.channel, event.sequence);
    this.persist();
    return event;
  }

  public reset(channel?: string, sequence = 0): void {
    if (channel) this.sequences.set(channel, Math.max(0, sequence));
    else this.sequences.clear();
    this.seen.clear();
    this.persist();
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) ?? '{}') as unknown;
      // A legacy scalar cursor has no channel identity and cannot safely seed
      // any channel. Replay from zero; retained event IDs still suppress repeats.
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [channel, value] of Object.entries(stored)) {
          const sequence = Number(value);
          if (channel && Number.isSafeInteger(sequence) && sequence >= 0) this.sequences.set(channel, sequence);
        }
      }
      const seen = JSON.parse(localStorage.getItem(this.seenKey) ?? '[]');
      if (Array.isArray(seen)) {
        for (const id of seen.slice(-500)) if (typeof id === 'string') this.seen.add(id);
      }
    } catch {
      this.sequences.clear();
      this.seen.clear();
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.sequences)));
      localStorage.setItem(this.seenKey, JSON.stringify([...this.seen].slice(-500)));
    } catch {
      // Storage is an optimization. Live transport remains functional if unavailable.
    }
  }
}
