import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../lib/apiBaseUrl';

export type DurableRealtimeEvent = {

export interface DurableRealtimeEvent {
  id: string;
  channel: string;
  sequence: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

type ReplayResponse = {
}

interface ReplayResponse {
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
}

interface ServerMessage {
  id?: string;
  type?: string;
  channel?: string;
  data?: unknown;
  error?: { code?: string; message?: string };
}

function websocketUrl(baseUrl?: string): string {
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
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

function readStoredCursor(channel: string): string {
  try {
    return canonicalCursor(localStorage.getItem(cursorKey(channel))) ?? '0';
  } catch {
    return '0';
  }
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
) {
  const [connected, setConnected] = useState(false);
  const [resyncRequired, setResyncRequired] = useState(false);
  const cursorRef = useRef<string>('0');
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const stoppedRef = useRef(false);
  baseUrl?: string,
): UseRealtimeEventsResult {
  const [connected, setConnected] = useState(false);
  const [resyncRequired, setResyncRequired] = useState(false);
  const [cursor, setCursor] = useState(() => readStoredCursor(channel));
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stoppedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const cursorRef = useRef(readStoredCursor(channel));

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const subscribe = useCallback((socket: WebSocket) => {
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
      data: { channel, afterSequence: cursorRef.current },
      data: { channel, afterSequence },
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
    if (!enabled || !channel) return;

    stoppedRef.current = false;
    const initialCursor = readStoredCursor(channel);
    cursorRef.current = initialCursor;
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
        if (message.type === 'event' && message.channel === channel && message.data && typeof message.data === 'object') {
          const data = message.data as Record<string, unknown>;
          const sequence = canonicalCursor(data.sequence);
          if (!sequence || typeof message.id !== 'string' || typeof data.eventType !== 'string' || typeof data.createdAt !== 'string') return;

          try {
            if (BigInt(sequence) <= BigInt(cursorRef.current)) return;
          } catch {
            return;
          }

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
    };

    try {
      const stored = localStorage.getItem(`ryanai:realtime-cursor:${channel}`);
      if (stored && /^(0|[1-9][0-9]*)$/.test(stored)) cursorRef.current = stored;
    } catch {
      // Continue from the in-memory cursor when storage is unavailable.
    }

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        if (!stoppedRef.current) reconnectTimerRef.current = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      stoppedRef.current = true;
w      setConnected(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [channel, enabled, subscribe]);
    };
  }, [baseUrl, channel, enabled, setCursorValue, subscribe]);

  const acknowledgeResync = useCallback(() => {
    setResyncRequired(false);
  }, []);

  return { connected, resyncRequired, cursor: cursorRef.current, acknowledgeResync };
  return { connected, resyncRequired, cursor, acknowledgeResync };
}
