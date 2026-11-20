import type { WebSocketMessage } from './types.js';

export type EventSequence = number | string;

export interface DurableEventEnvelope {
  id: string;
  sequence: EventSequence;
  channel: string;
  data: unknown;
  timestamp: number;
}

export interface EventReplayCursor {
  sequence: EventSequence;
}

function parseSequence(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function exposeSequence(value: bigint): EventSequence {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

export function normalizeEventEnvelope(message: WebSocketMessage): DurableEventEnvelope | null {
  if (message.type !== 'event' && message.type !== 'stream') return null;
  if (!message.id || !message.channel || !Number.isFinite(message.timestamp)) return null;

  const raw = message.data;
  const hasSequence = typeof raw === 'object' && raw !== null && 'sequence' in raw;
  const parsedSequence = hasSequence
    ? parseSequence((raw as Record<string, unknown>).sequence)
    : 0n;
  if (parsedSequence === null) return null;

  const data = hasSequence
    ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([key]) => key !== 'sequence'))
    : raw;

  return {
    id: message.id,
    sequence: exposeSequence(parsedSequence),
    channel: message.channel,
    data,
    timestamp: message.timestamp,
  };
}

/**
 * Per-channel durable event cursors. A single global cursor is unsafe when
 * independently subscribed channels emit at different rates: progress on one
 * channel could otherwise skip unseen events on another channel.
 *
 * PostgreSQL BIGINT sequences are kept as BigInt internally and serialized as
 * decimal strings when they exceed JavaScript's safe integer range.
 */
export class EventReplayCursorStore {
  private readonly storageKey: string;
  private readonly seenKey: string;
  private sequences = new Map<string, bigint>();
  private seen = new Set<string>();

  constructor(namespace = 'default') {
    this.storageKey = `ryanai:event-cursor:${namespace}`;
    this.seenKey = `ryanai:event-seen:${namespace}`;
    this.load();
  }

  public getCursor(channel: string): EventReplayCursor {
    return { sequence: exposeSequence(this.sequences.get(channel) ?? 0n) };
  }

  public accept(message: WebSocketMessage): DurableEventEnvelope | null {
    const event = normalizeEventEnvelope(message);
    if (!event || this.seen.has(event.id)) return null;

    const sequence = parseSequence(event.sequence);
    if (sequence === null) return null;
    const currentSequence = this.sequences.get(event.channel) ?? 0n;
    if (sequence > 0n && sequence < currentSequence) return null;

    this.seen.add(event.id);
    if (sequence > currentSequence) this.sequences.set(event.channel, sequence);
    this.persist();
    return event;
  }

  public reset(channel?: string, sequence: EventSequence = 0): void {
    const parsed = parseSequence(sequence);
    if (parsed === null) throw new Error('Replay cursor must be a non-negative integer');
    if (channel) this.sequences.set(channel, parsed);
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
          const sequence = parseSequence(value);
          if (channel && sequence !== null) this.sequences.set(channel, sequence);
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
      const cursors = Object.fromEntries(
        [...this.sequences].map(([channel, sequence]) => [channel, sequence.toString()]),
      );
      localStorage.setItem(this.storageKey, JSON.stringify(cursors));
      localStorage.setItem(this.seenKey, JSON.stringify([...this.seen].slice(-500)));
    } catch {
      // Storage is an optimization. Live transport remains functional if unavailable.
    }
  }
}
