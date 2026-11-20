import type { WebSocketMessage } from '../shared/types.js';
import { ref, type Ref } from 'vue';

export type RyanAIConnectionState =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'disconnected';

export interface ClientOptions {
  url?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  maxReconnectDelay?: number;
}

interface Subscription {
  channel: string;
  handler: (data: unknown) => void;
}

const DEFAULT_RECONNECT_INTERVAL = 3_000;
const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;

function nextReconnectDelay(base: number, attempt: number, max: number): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(exponential * 0.2 * Math.random());
  return Math.min(max, exponential + jitter);
}

function randomMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ryanai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Frontend transport continuity layer.
 *
 * Important safety boundary:
 * - subscriptions are restored automatically after reconnect;
 * - in-flight requests are NOT replayed automatically because the server may
 *   have committed the request before the connection dropped;
 * - durable offline work continues through offlineTaskOutbox/offlineTaskSyncClient.
 *
 * This prevents duplicate privileged actions while keeping the UI's live event
 * channels continuously recoverable.
 */
export class RyanAIClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectEnabled: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private maxReconnectDelay: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private manualDisconnect = false;
  private connectPromise: Promise<void> | null = null;
  private messageHandlers: Map<string, (data: WebSocketMessage) => void> = new Map();
  private requestTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventHandlers: Map<string, ((data: unknown) => void)[]> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();
  private browserOnline = true;
  private readonly onlineListener: () => void;
  private readonly offlineListener: () => void;

  public connected: Ref<boolean> = ref(false);
  public authenticated: Ref<boolean> = ref(false);
  public connectionState: Ref<RyanAIConnectionState> = ref('disconnected');

  constructor(options: ClientOptions = {}) {
    this.url = options.url || `ws://${window.location.host}/ws`;
    this.reconnectEnabled = options.reconnect !== false;
    this.reconnectInterval = Math.max(250, options.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL);
    this.maxReconnectAttempts = Math.max(0, options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS);
    this.maxReconnectDelay = Math.max(this.reconnectInterval, options.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY);

    this.browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    this.onlineListener = () => {
      this.browserOnline = true;
      if (!this.manualDisconnect && !this.connected.value) {
        void this.connect();
      }
    };
    this.offlineListener = () => {
      this.browserOnline = false;
      this.connectionState.value = 'offline';
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
    }
  }

  public async connect(token?: string): Promise<void> {
    if (this.connected.value && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.manualDisconnect = false;
    this.connectionState.value = this.browserOnline ? 'connecting' : 'offline';

    if (!this.browserOnline) {
      return Promise.reject(new Error('Browser is offline; the connection will resume when connectivity returns.'));
    }

    this.clearReconnectTimer();

    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      try {
        const socket = new WebSocket(this.url);
        this.ws = socket;

        socket.onopen = () => {
          settled = true;
          this.connected.value = true;
          this.connectionState.value = 'connected';
          this.reconnectAttempts = 0;

          // Restore subscriptions only. Requests are intentionally not replayed.
          for (const channel of this.subscriptions.keys()) {
            this.sendRaw({
              id: randomMessageId(),
              type: 'request',
              channel: 'subscribe',
              data: { channel },
              timestamp: Date.now(),
            });
          }

          if (token) {
            void this.send('auth.verify', { token }).catch(() => {
              this.authenticated.value = false;
            });
          }

          resolve();
        };

        socket.onmessage = (event: MessageEvent) => {
          try {
            this.handleMessage(JSON.parse(String(event.data)) as WebSocketMessage);
          } catch {
            this.connectionState.value = 'degraded';
            console.error('RyanAI WebSocket message parse error.');
          }
        };

        socket.onclose = () => {
          this.connected.value = false;
          this.authenticated.value = false;

          if (this.manualDisconnect) {
            this.connectionState.value = 'disconnected';
            return;
          }

          this.connectionState.value = this.browserOnline ? 'reconnecting' : 'offline';
          this.scheduleReconnect(token);
        };

        socket.onerror = (error: Event) => {
          this.connectionState.value = 'degraded';
          console.error('RyanAI WebSocket transport error:', error);
          if (!settled) {
            settled = true;
            reject(new Error('RyanAI WebSocket connection failed.'));
          }
        };
      } catch (error) {
        settled = true;
        this.connectionState.value = 'degraded';
        reject(error instanceof Error ? error : new Error('RyanAI WebSocket connection failed.'));
      }
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.connected.value = false;
    this.authenticated.value = false;
    this.connectionState.value = 'disconnected';

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }

  /** Remove browser listeners when the owning UI scope is permanently disposed. */
  public destroy(): void {
    this.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener);
      window.removeEventListener('offline', this.offlineListener);
    }
    for (const timeout of this.requestTimeouts.values()) clearTimeout(timeout);
    this.requestTimeouts.clear();
    this.messageHandlers.clear();
    this.eventHandlers.clear();
    this.subscriptions.clear();
  }

  /**
   * Sends a request. In-flight requests are never automatically replayed after
   * a transport loss because the server may have committed them already.
   */
  public send(channel: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = randomMessageId();
      const message: WebSocketMessage = {
        id,
        type: 'request',
        channel,
        data,
        timestamp: Date.now(),
      };

      const handler = (response: WebSocketMessage) => {
        this.messageHandlers.delete(id);
        const timeout = this.requestTimeouts.get(id);
        if (timeout) clearTimeout(timeout);
        this.requestTimeouts.delete(id);

        if (response.error) reject(new Error(response.error.message));
        else resolve(response.data);
      };

      this.messageHandlers.set(id, handler);
      this.requestTimeouts.set(id, setTimeout(() => {
        this.messageHandlers.delete(id);
        this.requestTimeouts.delete(id);
        reject(new Error('Request timeout'));
      }, 30_000));

      try {
        this.sendRaw(message);
      } catch (error) {
        this.messageHandlers.delete(id);
        const timeout = this.requestTimeouts.get(id);
        if (timeout) clearTimeout(timeout);
        this.requestTimeouts.delete(id);
        reject(error instanceof Error ? error : new Error('WebSocket send failed.'));
      }
    });
  }

  /** Registers a live event/stream handler and remembers the channel for reconnect resubscription. */
  public on(channel: string, handler: (data: unknown) => void): () => void {
    const subscription: Subscription = { channel, handler };
    const handlers = this.subscriptions.get(channel) ?? [];
    handlers.push(subscription);
    this.subscriptions.set(channel, handlers);

    if (this.connected.value) {
      void this.send('subscribe', { channel }).catch(() => {
        this.connectionState.value = 'degraded';
      });
    }

    return () => {
      const current = this.subscriptions.get(channel);
      if (!current) return;
      const next = current.filter((item) => item !== subscription);
      if (next.length === 0) this.subscriptions.delete(channel);
      else this.subscriptions.set(channel, next);
    };
  }

  public async reasoning(prompt: string, context?: Record<string, unknown>): Promise<string> {
    const response = await this.send('reasoning.start', {
      prompt,
      context,
      sessionId: `session-${Date.now()}`,
    });
    return typeof response === 'object'
      && response !== null
      && 'result' in response
      && typeof response.result === 'string'
      ? response.result
      : '';
  }

  private sendRaw(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(message: WebSocketMessage<{ authenticated?: boolean }>) {
    const { id, type, channel, data, error } = message;

    if (type === 'response' && this.messageHandlers.has(id)) {
      this.messageHandlers.get(id)!(message);
    }

    if (type === 'event' || type === 'stream') {
      for (const subscription of this.subscriptions.get(channel) ?? []) {
        subscription.handler(data);
      }
    }

    if (channel === 'auth.verify' && type === 'response') {
      this.authenticated.value = data?.authenticated === true;
    }

    if (type === 'error') {
      this.connectionState.value = 'degraded';
      console.error(`RyanAI WebSocket error [${error?.code ?? 'UNKNOWN'}]: ${error?.message ?? 'Unknown error'}`);
    }
  }

  private scheduleReconnect(token?: string): void {
    if (!this.reconnectEnabled || this.manualDisconnect || !this.browserOnline) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.connectionState.value = 'degraded';
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts += 1;
    const delay = nextReconnectDelay(
      this.reconnectInterval,
      this.reconnectAttempts,
      this.maxReconnectDelay,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(token).catch(() => {
        // The socket's close/error lifecycle schedules the next attempt.
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export function useRyanAI(options?: ClientOptions) {
  const client = new RyanAIClient(options);
  const connected = ref(false);
  const authenticated = ref(false);
  const connectionState = ref<RyanAIConnectionState>('disconnected');

  const connect = async (token?: string) => {
    await client.connect(token);
    connected.value = client.connected.value;
    authenticated.value = client.authenticated.value;
    connectionState.value = client.connectionState.value;
  };

  const reason = async (prompt: string) => client.reasoning(prompt);

  const subscribe = (channel: string, handler: (data: unknown) => void) =>
    client.on(channel, handler);

  return {
    client,
    connected,
    authenticated,
    connectionState,
    connect,
    reason,
    subscribe,
  };
}
