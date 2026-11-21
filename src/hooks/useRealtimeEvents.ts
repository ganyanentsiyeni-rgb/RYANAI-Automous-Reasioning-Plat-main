import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../lib/apiBaseUrl';

export interface DurableRealtimeEvent {
  id: string;
  channel: string;
  sequence: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

interface ReplayResponse {
  subscribed?: string;
  replayed?: number;
  hasMore?: boolean;
  nextCursor?: string;
  cursorExpired?: boolean;
  resyncRequired?: boolean;
}

interface ServerMessage {
  id?: string;
  type?: string;
  channel?: string;
  data?: unknown;
  error?: { code?: string; message?: string };
}

function websocketUrl(baseUrl?: string): string {
  const base = baseUrl ?? API_BASE_URL ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const url = new URL('/ws', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function canonicalCursor(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return value;
}

export function cursorKey(channel: string): string {
  return `ryanai:realtime-cursor:${channel}`;
}

export interface UseRealtimeEventsResult {
  connected: boolean;
  resyncRequired: boolean;
  cursor: string;
  acknowledgeResync: () => void;
}

export function useRealtimeEvents(
  channel: string,
  onEvent: (event: DurableRealtimeEvent) => void,
  enabled = true,
  baseUrl?: string,
): UseRealtimeEventsResult {
  const [connected, setConnected] = useState(false);
  const [resyncRequired, setResyncRequired] = useState(false);
  const [cursor, setCursor] = useState('0');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stoppedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const cursorRef = useRef('0');

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const setCursorValue = useCallback((value: unknown) => {
    const next = canonicalCursor(value);
    if (next === null) return;
    cursorRef.current = next;
    setCursor(next);
    try {
      localStorage.setItem(cursorKey(channel), next);
    } catch {
      // Browser storage is optional; durable replay remains authoritative.
    }
  }, [channel]);

  const subscribe = useCallback((socket: WebSocket, afterSequence: string) => {
    socket.send(JSON.stringify({
      id: crypto.randomUUID(),
      type: 'request',
      channel: 'subscribe',
      data: { channel, afterSequence },
    }));
  }, [channel]);

  useEffect(() => {
    if (!enabled || !channel) return;

    stoppedRef.current = false;
    let initialCursor: string;
    try {
      initialCursor = canonicalCursor(localStorage.getItem(cursorKey(channel))) ?? '0';
    } catch {
      initialCursor = '0';
    }
    cursorRef.current = initialCursor;
    setCursor(initialCursor);
    setResyncRequired(false);

    const connect = () => {
      if (stoppedRef.current) return;
      const socket = new WebSocket(websocketUrl(baseUrl));
      socketRef.current = socket;

      socket.onopen = () => {
        if (stoppedRef.current) return;
        setConnected(true);
        setResyncRequired(false);
        subscribe(socket, cursorRef.current);
      };

      socket.onmessage = (event) => {
        if (stoppedRef.current) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'event' && message.channel === channel && message.data && typeof message.data === 'object') {
          const data = message.data as Record<string, unknown>;
          const sequence = canonicalCursor(data.sequence);
          if (!sequence || typeof message.id !== 'string' || typeof data.eventType !== 'string' || typeof data.createdAt !== 'string') return;

          let isNew: boolean;
          try {
            isNew = BigInt(sequence) > BigInt(cursorRef.current);
          } catch {
            isNew = false;
          }
          if (!isNew) return;

          setCursorValue(sequence);
          onEventRef.current({
            id: message.id,
            channel,
            sequence,
            eventType: data.eventType,
            payload: data.payload,
            createdAt: data.createdAt,
          });
          return;
        }

        if (message.type === 'response' && message.channel === 'subscribe' && message.data && typeof message.data === 'object') {
          const response = message.data as ReplayResponse;
          if (response.cursorExpired || response.resyncRequired) {
            setResyncRequired(true);
            setCursorValue(response.nextCursor ?? '0');
            return;
          }

          if (response.nextCursor !== undefined) setCursorValue(response.nextCursor);
          if (response.hasMore) subscribe(socket, canonicalCursor(response.nextCursor) ?? cursorRef.current);
          return;
        }

        if (message.type === 'error' && message.error?.code === 'REPLAY_BACKLOG_EXCEEDED') {
          setResyncRequired(true);
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        if (!stoppedRef.current) reconnectTimerRef.current = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      stoppedRef.current = true;
      setConnected(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [baseUrl, channel, enabled, setCursorValue, subscribe]);

  const acknowledgeResync = useCallback(() => {
    setResyncRequired(false);
  }, []);

  return { connected, resyncRequired, cursor, acknowledgeResync };
}
