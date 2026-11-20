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
  if (!message.id || !Number.isFinite(message.timestamp)) return null;

  const raw = message.data;
  const sequence =
    typeof raw === 'object' && raw !== null && 'sequence' in raw && Number.isFinite(Number(raw.sequence))
      ? Number(raw.sequence)
      : 0;

  const data =
    typeof raw === 'object' && raw !== null && 'sequence' in raw
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'sequence'))
      : raw;

  return {
    id: message.id,
    sequence,
    channel: message.channel,
    data,
    timestamp: message.timestamp,
  };
}

/**
 * Client-side durable event cursor.
 *
 * The cursor is intentionally monotonic. A reconnect can ask the server for
 * events after this sequence, while duplicate/older events are ignored locally.
 * Persistence is kept behind the browser storage boundary so this transport
 * layer does not introduce a database or a second server-side event store.
 */
export class EventReplayCursorStore {
  private readonly storageKey: string;
  private readonly seenKey: string;
  private sequence = 0;
  private seen = new Set<string>();

  constructor(namespace = 'default') {
    this.storageKey = `ryanai:event-cursor:${namespace}`;
    this.seenKey = `ryanai:event-seen:${namespace}`;
    this.load();
  }

  public getCursor(): EventReplayCursor {
    return { sequence: this.sequence };
  }

  public accept(message: WebSocketMessage): DurableEventEnvelope | null {
    const event = normalizeEventEnvelope(message);
    if (!event) return null;

    if (this.seen.has(event.id)) return null;
    if (event.sequence > 0 && event.sequence < this.sequence) return null;

    this.seen.add(event.id);
    if (event.sequence > this.sequence) this.sequence = event.sequence;
    this.persist();
    return event;
  }

  public reset(sequence = 0): void {
    this.sequence = Math.max(0, sequence);
    this.seen.clear();
    this.persist();
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const storedSequence = Number(localStorage.getItem(this.storageKey) ?? 0);
      this.sequence = Number.isFinite(storedSequence) ? Math.max(0, storedSequence) : 0;

      const seen = JSON.parse(localStorage.getItem(this.seenKey) ?? '[]');
      if (Array.isArray(seen)) {
        for (const id of seen.slice(-500)) {
          if (typeof id === 'string') this.seen.add(id);
        }
      }
    } catch {
      this.sequence = 0;
      this.seen.clear();
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(this.storageKey, String(this.sequence));
      localStorage.setItem(this.seenKey, JSON.stringify([...this.seen].slice(-500)));
    } catch {
      // Storage is an optimization. Live transport remains functional if it is unavailable.
    }
  }
}
