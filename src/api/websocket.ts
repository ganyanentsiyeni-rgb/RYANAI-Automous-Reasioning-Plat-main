// src/api/websocket.ts - Real-time WebSocket bridge
import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { WebSocketMessage, AuthContext, ReasoningRequest } from '../shared/types.js';
import { createLogger } from '../shared/logger.js';
import { requireAdmin } from '../server/routes/auth.js';
import { prisma } from '../lib/prisma.js';
import { appendRealtimeEvent, replayRealtimeEvents } from '../server/realtime/eventStore.js';

const logger = createLogger('websocket');

interface ConnectionContext {
  id: string;
  ws: WebSocket;
  auth?: AuthContext;
  subscriptions: Set<string>;
  replayingChannels: Set<string>;
  pendingDurableEvents: Map<string, Array<{ id: string; sequence: bigint; eventType: string; payload: unknown; createdAt: Date }>>;
  messageCount: number;
  connectedAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  messageWindowTimer?: ReturnType<typeof setTimeout>;
  closed?: boolean;
}

const connections = new Map<string, ConnectionContext>();
const channels = new Map<string, Set<string>>();

function scopedChannelKey(userId: string, channel: string): string {
  return `user:${userId}:${channel}`;
}

function sendDurableEvent(context: ConnectionContext, channel: string, event: { id: string; sequence: bigint; eventType: string; payload: unknown; createdAt: Date }) {
  sendMessage(context.ws, {
    id: event.id,
    type: 'event',
    channel,
    data: { sequence: event.sequence.toString(), eventType: event.eventType, payload: event.payload, createdAt: event.createdAt.toISOString() },
    timestamp: event.createdAt.getTime(),
  });
}

export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  logger.info('Registering WebSocket routes');

  fastify.get(
    '/ws',
    {
      websocket: true,
      preValidation: requireAdmin,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (socket, request: FastifyRequest) => {
      const connId = uuid();
      const auth = extractAuth(request);

      const context: ConnectionContext = {
        id: connId,
        ws: socket as WebSocket,
        auth,
        subscriptions: new Set(),
        replayingChannels: new Set(),
        pendingDurableEvents: new Map(),
        messageCount: 0,
        connectedAt: Date.now(),
        closed: false,
      };

      connections.set(connId, context);
      logger.info({ connId, auth: auth?.email }, 'WebSocket connected');

      context.expiryTimer = setTimeout(() => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1008, 'Reauthenticate');
        }
      }, 300_000);

      socket.on('message', async (data: Buffer) => {
        if (context.closed || socket.readyState !== socket.OPEN) return;

        // Start one fixed 60-second window when the first message arrives.
        if (context.messageCount === 0 && !context.messageWindowTimer) {
          context.messageWindowTimer = setTimeout(() => {
            context.messageCount = 0;
            context.messageWindowTimer = undefined;
          }, 60_000);
        }

        // Count every message, including malformed JSON.
        if (context.messageCount >= 60) {
          sendError(
            socket as WebSocket,
            'RATE_LIMITED',
            'Message rate limit exceeded',
          );
          socket.close(1008, 'Message rate limit exceeded');
          return;
        }

        context.messageCount += 1;

        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          await handleMessage(context, message);
        } catch (err) {
          logger.error({ err, connId }, 'Message handling error');
          sendError(
            socket as WebSocket,
            'PARSE_ERROR',
            'Invalid message format',
          );
        }
      });

      socket.on('close', () => {
        context.closed = true;

        if (context.expiryTimer) {
          clearTimeout(context.expiryTimer);
          context.expiryTimer = undefined;
        }

        if (context.messageWindowTimer) {
          clearTimeout(context.messageWindowTimer);
          context.messageWindowTimer = undefined;
        }

        connections.delete(connId);

        context.subscriptions.forEach((channel) => {
          const channelSubs = channels.get(scopedChannelKey(context.auth!.userId, channel));
          if (channelSubs) {
            channelSubs.delete(connId);
            if (channelSubs.size === 0) channels.delete(scopedChannelKey(context.auth!.userId, channel));
          }
        });

        context.subscriptions.clear();
        logger.info({ connId }, 'WebSocket disconnected');
      });

      socket.on('error', (err) => {
        logger.error({ err, connId }, 'WebSocket error');
      });
    },
  );
}

async function handleMessage(context: ConnectionContext, message: WebSocketMessage) {
  const { id, type, channel, data } = message;

  logger.debug({ messageId: id, type, channel }, 'WebSocket message received');

  const response: WebSocketMessage = {
    id,
    type: 'response',
    channel,
    timestamp: Date.now(),
  };

  try {
    switch (type) {
      case 'request':
        if (channel === 'auth.verify') {
          response.data = { authenticated: !!context.auth, userId: context.auth?.userId };
        } else if (channel === 'reasoning.start') {
          handleReasoningRequest(context, data as ReasoningRequest);
          response.data = { queued: true, sessionId: (data as ReasoningRequest).sessionId };
        } else if (channel === 'subscribe') {
          if (!data || typeof data !== 'object' || !('channel' in data) || typeof data.channel !== 'string') {
            throw new Error('A subscription channel is required');
          }
          if (!context.auth?.userId) throw new Error('An authenticated user is required');
          if (!/^[a-z][a-z0-9._:-]{0,119}$/.test(data.channel)) throw new Error('Invalid subscription channel');
          const key = scopedChannelKey(context.auth.userId, data.channel);
          const cursorValue = 'afterSequence' in data ? data.afterSequence : '0';
          const cursorText = typeof cursorValue === 'number' ? String(cursorValue) : cursorValue;
          if (typeof cursorText !== 'string' || !/^(0|[1-9][0-9]*)$/.test(cursorText)) throw new Error('Replay cursor must be a non-negative integer string');
          // Register before reading history so events published during replay
          // are buffered and cannot overtake older persisted events.
          context.replayingChannels.add(key);
          context.subscriptions.add(data.channel);
          if (!channels.has(key)) channels.set(key, new Set());
          channels.get(key)!.add(context.id);
          const replay = await replayRealtimeEvents(prisma, {
            audience: { type: 'user', id: context.auth.userId },
            channel: data.channel,
            afterSequence: BigInt(cursorText),
            limit: 50,
          });
          if (replay.cursorExpired) {
            context.replayingChannels.delete(key);
            flushPendingDurableEvents(context, key, data.channel, replay.nextCursor);
            response.data = { subscribed: data.channel, cursorExpired: true, resyncRequired: true, nextCursor: replay.nextCursor.toString() };
          } else {
            for (const event of replay.events) sendDurableEvent(context, data.channel, event);
            // Keep live events buffered while more history pages remain. The
            // client requests the next page using nextCursor; only the final
            // page releases live delivery, preserving sequence order.
            if (!replay.hasMore) {
              context.replayingChannels.delete(key);
              flushPendingDurableEvents(context, key, data.channel, replay.nextCursor);
            }
            response.data = { subscribed: data.channel, replayed: replay.events.length, hasMore: replay.hasMore, nextCursor: replay.nextCursor.toString() };
          }

        } else {
          response.error = { code: 'UNKNOWN_CHANNEL', message: 'Unknown channel' };
        }
        break;

      case 'stream':
        if (channel === 'reasoning.stream') {
          // Stream handling is continuous; response confirms receipt
          response.data = { streaming: true };
        }
        break;

      default:
        response.error = { code: 'UNKNOWN_TYPE', message: 'Unknown message type' };
    }
  } catch (err: unknown) {
    response.error = { code: 'HANDLER_ERROR', message: (err instanceof Error ? err.message : String(err)) };
  }

  sendMessage(context.ws, response);
}

function handleReasoningRequest(context: ConnectionContext, request: ReasoningRequest) {
  // Simulate streaming response
  const { sessionId } = request;

  // Send progress events
  ['Parsing context...', 'Initializing LangGraph...', 'Processing...', 'Complete'].forEach(
    (msg, idx) => {
      setTimeout(() => {
        const event: WebSocketMessage = {
          id: uuid(),
          type: 'stream',
          channel: 'reasoning.stream',
          data: {
            type: msg === 'Complete' ? 'complete' : 'progress',
            progress: ((idx + 1) / 4) * 100,
            message: msg,
            sessionId,
          },
          timestamp: Date.now(),
        };

        if (context.ws.readyState === context.ws.OPEN) {
          sendMessage(context.ws, event);
        }
      }, idx * 400);
    }
  );
}

function flushPendingDurableEvents(context: ConnectionContext, key: string, channel: string, afterSequence: bigint) {
  const pending = context.pendingDurableEvents.get(key) ?? [];
  context.pendingDurableEvents.delete(key);
  const ordered = pending
    .filter((event) => event.sequence > afterSequence)
    .sort((left, right) => left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0);
  let lastSequence = afterSequence;
  for (const event of ordered) {
    if (event.sequence <= lastSequence) continue;
    sendDurableEvent(context, channel, event);
    lastSequence = event.sequence;
  }
}

/**
 * Durable publisher. The database append completes before any socket delivery.
 * Audience is always derived from this server-side function argument, never a
 * browser-supplied audience field.
 */
export async function publishRealtimeEvent(input: {
  userId: string;
  channel: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const persisted = await appendRealtimeEvent(prisma, {
    audience: { type: 'user', id: input.userId },
    channel: input.channel,
    eventType: input.eventType,
    payload: input.payload,
  });
  const key = scopedChannelKey(input.userId, input.channel);
  for (const connId of channels.get(key) ?? []) {
    const conn = connections.get(connId);
    if (conn && !conn.closed && conn.ws.readyState === conn.ws.OPEN) {
      if (conn.replayingChannels.has(key)) {
        const pending = conn.pendingDurableEvents.get(key) ?? [];
        pending.push(persisted);
        conn.pendingDurableEvents.set(key, pending);
      } else {
        sendDurableEvent(conn, input.channel, persisted);
      }
    }
  }
  return { id: persisted.id, sequence: persisted.sequence.toString() };
}

/**
 * Legacy ephemeral system notifications only. User/workspace business events
 * must use publishRealtimeEvent so persistence precedes delivery.
 */
export function broadcast(channel: string, data: unknown) {
  if (!channel.startsWith('system.')) {
    logger.warn({ channel }, 'Ignored non-system ephemeral broadcast; use publishRealtimeEvent');
    return;
  }
  const event: WebSocketMessage = { id: uuid(), type: 'event', channel, data, timestamp: Date.now() };
  for (const conn of connections.values()) {
    if (conn.auth && conn.subscriptions.has(channel) && conn.ws.readyState === conn.ws.OPEN) {
      sendMessage(conn.ws, event);
    }
  }
}

function sendMessage(ws: WebSocket, message: WebSocketMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, code: string, message: string) {
  const msg: WebSocketMessage = {
    id: uuid(),
    type: 'error',
    channel: 'system',
    error: { code, message },
    timestamp: Date.now(),
  };
  sendMessage(ws, msg);
}

function extractAuth(request: FastifyRequest): AuthContext | undefined {
  if (!request.authUser) return undefined;
  return {
    userId: request.authUser.id,
    email: request.authUser.email ?? '',
    name: request.authUser.email || request.authUser.id,
    roles: [request.authUser.role],
    sessionId: uuid(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  };
}

export default registerWebSocketRoutes;