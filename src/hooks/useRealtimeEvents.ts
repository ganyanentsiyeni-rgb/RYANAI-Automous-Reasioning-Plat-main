import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../lib/apiBaseUrl';

export type DurableRealtimeEvent = {
  id: string;
  channel: string;
  sequence: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

type ReplayResponse = {
  subscribed?: string;
  replayed?: number;
  hasMore?: boolean;
  nextCursor?: string;
  cursorExpired?: boolean;
  resyncRequired?: boolean;
};

type ServerMessage = {
  id?: string;
  type?: string;
  channel?: string;
  data?: {
    sequence?: string;
    eventType?: string;
    payload?: unknown;
    createdAt?: string;
    [key: string]: unknown;
  };
};

function websocketUrl(): string {
  const base = API_BASE_URL || window.location.origin;
  const url = new URL('/ws', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function useRealtimeEvents(
  channel: string,
  onEvent: (event: DurableRealtimeEvent) => void,
  enabled = true,
) {
  const [connected, setConnected] = useState(false);
  const [resyncRequired, setResyncRequired] = useState(false);
  const cursorRef = useRef<string>('0');
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const stoppedRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const subscribe = useCallback((socket: WebSocket) => {
    socket.send(JSON.stringify({
      id: crypto.randomUUID(),
      type: 'request',
      channel: 'subscribe',
      data: { channel, afterSequence: cursorRef.current },
    }));
  }, [channel]);

  useEffect(() => {
    if (!enabled) return;
    stoppedRef.current = false;

    const connect = () => {
      if (stoppedRef.current) return;
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setResyncRequired(false);
        subscribe(socket);
      };

      socket.onmessage = (message) => {
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(message.data as string) as ServerMessage;
        } catch {
          return;
        }

        if (parsed.type === 'event' && parsed.channel === channel && parsed.data?.sequence) {
          const event: DurableRealtimeEvent = {
            id: parsed.id || parsed.data.sequence,
            channel,
            sequence: parsed.data.sequence,
            eventType: String(parsed.data.eventType || ''),
            payload: parsed.data.payload,
            createdAt: String(parsed.data.createdAt || ''),
          };
          if (BigInt(event.sequence) <= BigInt(cursorRef.current)) return;
          cursorRef.current = event.sequence;
          try {
            localStorage.setItem(`ryanai:realtime-cursor:${channel}`, event.sequence);
          } catch {
            // Cursor persistence is best-effort; replay remains server-authoritative.
          }
          onEventRef.current(event);
          return;
        }

        if (parsed.type === 'response' && parsed.channel === 'subscribe') {
          const data = parsed.data as ReplayResponse | undefined;
          if (data?.cursorExpired || data?.resyncRequired) {
            setResyncRequired(true);
            cursorRef.current = data.nextCursor || '0';
            return;
          }
          if (data?.nextCursor && data.nextCursor !== cursorRef.current) {
            cursorRef.current = data.nextCursor;
            try {
              localStorage.setItem(`ryanai:realtime-cursor:${channel}`, data.nextCursor);
            } catch {
              // Best-effort persistence.
            }
          }
          if (data?.hasMore) subscribe(socket);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!stoppedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 1000);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    try {
      const stored = localStorage.getItem(`ryanai:realtime-cursor:${channel}`);
      if (stored && /^(0|[1-9][0-9]*)$/.test(stored)) cursorRef.current = stored;
    } catch {
      // Continue from the in-memory cursor when storage is unavailable.
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [channel, enabled, subscribe]);

  const acknowledgeResync = useCallback(() => {
    setResyncRequired(false);
  }, []);

  return { connected, resyncRequired, cursor: cursorRef.current, acknowledgeResync };
}
