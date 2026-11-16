import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireUser } from './auth.js';
import { DEFAULT_LANGUAGE, isRyanLanguage } from '../../shared/languages.js';
import { issueRealtimeVoiceTicket, type RedisVoiceTicketStore } from '../voice/realtimeVoiceTicket.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_NAME_MAX = 80;
const CAPABILITIES = new Set([
  'files.receive', 'files.send', 'comms.receive', 'notifications.receive',
  'voice.upload', 'voice.live', 'camera.upload', 'share.receive', 'tasks.receive',
]);

type DeviceBody = { deviceName?: string; platform?: string; capabilities?: string[] };
type PairingBody = { pairingCode?: string; deviceName?: string; platform?: string; capabilities?: string[] };

function safeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && CAPABILITIES.has(item)))];
}

function safeDeviceName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, DEVICE_NAME_MAX) || 'Android device' : 'Android device';
}

/**
 * PhoneLink v1 deliberately uses the authenticated RyanAI account as the
 * identity authority. Pairing codes are short-lived, single-use and stored
 * only as SHA-256 digests. Native device sessions use a short-lived exchange code and a revocable bearer token; the server stores only its digest.
 */
export const phoneLinkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/phonelink/device-sessions/exchange')
      || request.url.startsWith('/api/phonelink/mobile/')) return;
    await requireUser(request, reply);
  });

  const authenticateDevice = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(request.headers.authorization ?? '')?.[1];
    if (!token) {
      reply.code(401).send({ error: 'A valid PhoneLink device session is required.' });
      return null;
    }
    const devices = await fastify.prisma.$queryRawUnsafe<Array<{ id: string; user_id: string; capabilities: string[] }>>(
      'SELECT id, user_id, capabilities FROM phonelink_devices WHERE device_token_hash = $1 AND status = $2 LIMIT 1',
      digest(token), 'paired',
    );
    const device = devices[0];
    if (!device) {
      reply.code(401).send({ error: 'PhoneLink device session is expired or revoked. Pair this phone again.' });
      return null;
    }
    await fastify.prisma.$executeRawUnsafe(
      'UPDATE phonelink_devices SET last_seen_at = NOW() WHERE id = $1 AND status = $2',
      device.id, 'paired',
    );
    return device;
  };

  fastify.post<{ Body: { exchangeCode?: string } }>('/api/phonelink/device-sessions/exchange', async (request, reply) => {
    const code = typeof request.body?.exchangeCode === 'string' ? request.body.exchangeCode.trim() : '';
    if (!/^[A-Za-z0-9_-]{30,50}$/.test(code)) return reply.code(400).send({ error: 'Invalid one-time device exchange code.' });
    const deviceToken = randomBytes(32).toString('base64url');
    const result = await fastify.prisma.$transaction(async (tx) => {
      const exchanges = await tx.$queryRawUnsafe<Array<{ device_id: string }>>(
        'UPDATE phonelink_device_exchanges SET consumed_at = NOW() WHERE exchange_hash = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING device_id',
        digest(code),
      );
      const exchange = exchanges[0];
      if (!exchange) return null;
      const updated = await tx.$queryRawUnsafe<Array<{ id: string; device_name: string; capabilities: string[] }>>(
        'UPDATE phonelink_devices SET device_token_hash = $1, last_seen_at = NOW(), updated_at = NOW() WHERE id = $2 AND status = $3 RETURNING id, device_name, capabilities',
        digest(deviceToken), exchange.device_id, 'paired',
      );
      return updated[0] ?? null;
    });
    if (!result) return reply.code(410).send({ error: 'The one-time exchange has expired or already been used.' });
    return { deviceToken, device: { id: result.id, deviceName: result.device_name, capabilities: result.capabilities } };
  });

  fastify.post<{ Body: { language?: string; voice?: string; anniversaryEvolution?: boolean } }>('/api/phonelink/mobile/voice-ticket', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, properties: { language: { type: 'string', maxLength: 16 }, voice: { type: 'string', maxLength: 32 }, anniversaryEvolution: { type: 'boolean' } } } },
  }, async (request, reply) => {
    const device = await authenticateDevice(request, reply);
    if (!device) return;
    if (!(device.capabilities ?? []).includes('voice.live')) {
      return reply.code(403).send({ error: 'This PhoneLink device has not been granted the live voice capability.' });
    }
    const requestedLanguage = request.body?.language;
    const language = requestedLanguage && isRyanLanguage(requestedLanguage) ? requestedLanguage : DEFAULT_LANGUAGE;
    const redis = fastify.redis as unknown as RedisVoiceTicketStore;
    const issued = await issueRealtimeVoiceTicket(redis, { userId: device.user_id, isOwner: false, language, requestedVoice: request.body?.voice, anniversaryEvolution: request.body?.anniversaryEvolution, deviceId: device.id });
    if (!issued) return reply.code(503).send({ error: 'Could not authorize a live voice session. Please retry.' });
    return reply.code(201).send(issued);
  });

  fastify.get('/api/phonelink/mobile/events', async (request, reply) => {
    const device = await authenticateDevice(request, reply);
    if (!device) return;
    const events = await fastify.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, event_type AS "eventType", title, body, metadata, created_at AS "createdAt", expires_at AS "expiresAt" FROM phonelink_events WHERE device_id = $1 AND status = $2 AND expires_at > NOW() ORDER BY created_at ASC LIMIT 50',
      device.id, 'queued',
    );
    const granted = new Set(device.capabilities ?? []);
    return { events: events.filter(event => {
      const type = String(event.eventType ?? '');
      if (type.startsWith('comms.')) return granted.has('comms.receive');
      if (type.startsWith('studio.')) return granted.has('tasks.receive');
      if (type === 'file.ready') return granted.has('files.send');
      return false;
    }) };
  });

  fastify.post<{ Params: { eventId: string } }>('/api/phonelink/mobile/events/:eventId/ack', async (request, reply) => {
    if (!DEVICE_ID.test(request.params.eventId)) return reply.code(400).send({ error: 'Invalid event reference.' });
    const device = await authenticateDevice(request, reply);
    if (!device) return;
    const updated = await fastify.prisma.$executeRawUnsafe(
      'UPDATE phonelink_events SET status = $1, acknowledged_at = NOW() WHERE id = $2 AND device_id = $3 AND status = $4',
      'acknowledged', request.params.eventId, device.id, 'queued',
    );
    if (!updated) return reply.code(404).send({ error: 'Queued event not found.' });
    return { success: true, status: 'acknowledged' };
  });

  fastify.get('/api/phonelink/devices', async (request) => {
    const userId = request.authUser!.id;
    const devices = await fastify.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, device_name AS "deviceName", platform, capabilities, status, last_seen_at AS "lastSeenAt", created_at AS "createdAt" FROM phonelink_devices WHERE user_id = $1 ORDER BY created_at DESC',
      userId,
    );
    return { devices };
  });

  fastify.post('/api/phonelink/pairings', async (request, reply) => {
    const userId = request.authUser!.id;
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await fastify.prisma.$executeRawUnsafe(
      'INSERT INTO phonelink_pairings (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)',
      randomUUID(), userId, digest(code), expiresAt,
    );
    reply.code(201);
    return { pairingCode: code, expiresAt: expiresAt.toISOString(), expiresInSeconds: 300 };
  });

  fastify.post<{ Body: PairingBody }>('/api/phonelink/pairings/claim', async (request, reply) => {
    const userId = request.authUser!.id;
    const code = typeof request.body?.pairingCode === 'string' ? request.body.pairingCode.trim() : '';
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) return reply.code(400).send({ error: 'Enter a valid PhoneLink pairing code.' });
    const deviceId = randomUUID();
    const exchangeCode = randomBytes(24).toString('base64url');
    const deviceName = safeDeviceName(request.body?.deviceName);
    const platform = typeof request.body?.platform === 'string' ? request.body.platform.slice(0, 32) : 'android';
    const capabilities = safeCapabilities(request.body?.capabilities);
    try {
      const result = await fastify.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRawUnsafe<Array<{ user_id: string }>>(
          'UPDATE phonelink_pairings SET consumed_at = NOW() WHERE code_hash = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > NOW() RETURNING user_id',
          digest(code), userId,
        );
        if (!claimed.length) return false;
        await tx.$executeRawUnsafe(
          'INSERT INTO phonelink_devices (id, user_id, device_name, platform, capabilities, status, last_seen_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())',
          deviceId, userId, deviceName, platform, JSON.stringify(capabilities), 'paired',
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO phonelink_device_exchanges (id, device_id, exchange_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')",
          randomUUID(), deviceId, digest(exchangeCode),
        );
        return true;
      });
      if (!result) return reply.code(404).send({ error: 'Pairing code is expired, already used or belongs to another account.' });
      reply.code(201);
      return { device: { id: deviceId, deviceName, platform, capabilities, status: 'paired' }, exchangeCode, exchangeExpiresInSeconds: 120 };
    } catch (error) {
      request.log.error({ err: error }, 'PhoneLink device pairing failed');
      return reply.code(503).send({ error: 'PhoneLink storage is not ready. Apply the reviewed PhoneLink database migration before pairing.' });
    }
  });

  fastify.patch<{ Params: { id: string }; Body: DeviceBody }>('/api/phonelink/devices/:id', async (request, reply) => {
    if (!DEVICE_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid device id.' });
    const userId = request.authUser!.id;
    const name = safeDeviceName(request.body?.deviceName);
    const capabilities = safeCapabilities(request.body?.capabilities);
    const updated = await fastify.prisma.$executeRawUnsafe(
      'UPDATE phonelink_devices SET device_name = $1, capabilities = $2::jsonb, updated_at = NOW() WHERE id = $3 AND user_id = $4 AND status = $5',
      name, JSON.stringify(capabilities), request.params.id, userId, 'paired',
    );
    if (!updated) return reply.code(404).send({ error: 'Trusted device not found.' });
    return { success: true, device: { id: request.params.id, deviceName: name, capabilities } };
  });

  fastify.delete<{ Params: { id: string } }>('/api/phonelink/devices/:id', async (request, reply) => {
    if (!DEVICE_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid device id.' });
    const result = await fastify.prisma.$executeRawUnsafe(
      'UPDATE phonelink_devices SET status = $1, revoked_at = NOW(), updated_at = NOW() WHERE id = $2 AND user_id = $3 AND status <> $1',
      'revoked', request.params.id, request.authUser!.id,
    );
    if (!result) return reply.code(404).send({ error: 'Trusted device not found.' });
    return { success: true, status: 'revoked' };
  });

  fastify.post<{ Body: { type?: string; title?: string; body?: string; metadata?: Record<string, unknown> } }>('/api/phonelink/events', async (request, reply) => {
    const allowedTypes = new Set(['comms.dispatch.accepted', 'comms.delivery.updated', 'studio.task.updated', 'file.ready']);
    const type = typeof request.body?.type === 'string' ? request.body.type : '';
    const title = typeof request.body?.title === 'string' ? request.body.title.trim().slice(0, 120) : '';
    const body = typeof request.body?.body === 'string' ? request.body.body.trim().slice(0, 1000) : '';
    if (!allowedTypes.has(type) || !title) return reply.code(400).send({ error: 'Choose a supported PhoneLink event and a title.' });
    const userId = request.authUser!.id;
    const metadata = request.body?.metadata && typeof request.body.metadata === 'object' && !Array.isArray(request.body.metadata) ? request.body.metadata : {};
    const result = await fastify.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'INSERT INTO phonelink_events (id, user_id, device_id, event_type, title, body, metadata, status, expires_at) SELECT gen_random_uuid(), d.user_id, d.id, $2, $3, $4, $5::jsonb, $6, NOW() + INTERVAL \'7 days\' FROM phonelink_devices d WHERE d.user_id = $1 AND d.status = $7 AND d.capabilities @> $8::jsonb RETURNING id',
      userId, type, title, body, JSON.stringify(metadata), 'queued', 'paired', JSON.stringify([type.startsWith('comms.') ? 'comms.receive' : type.startsWith('studio.') ? 'tasks.receive' : 'files.send']),
    );
    reply.code(201);
    return { queued: result.length, eventIds: result.map(item => item.id) };
  });

  fastify.get('/api/phonelink/events', async (request) => {
    const events = await fastify.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, device_id AS "deviceId", event_type AS "eventType", title, body, metadata, created_at AS "createdAt", expires_at AS "expiresAt" FROM phonelink_events WHERE user_id = $1 AND status = $2 AND expires_at > NOW() ORDER BY created_at ASC LIMIT 50',
      request.authUser!.id, 'queued',
    );
    return { events };
  });

  fastify.get<{ Params: { id: string } }>('/api/phonelink/devices/:id/events', async (request, reply) => {
    if (!DEVICE_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid device id.' });
    const events = await fastify.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, event_type AS "eventType", title, body, metadata, created_at AS "createdAt", expires_at AS "expiresAt" FROM phonelink_events WHERE device_id = $1 AND user_id = $2 AND status = $3 AND expires_at > NOW() ORDER BY created_at ASC LIMIT 50',
      request.params.id, request.authUser!.id, 'queued',
    );
    return { events };
  });

  fastify.post<{ Params: { id: string; eventId: string } }>('/api/phonelink/devices/:id/events/:eventId/ack', async (request, reply) => {
    if (!DEVICE_ID.test(request.params.id) || !DEVICE_ID.test(request.params.eventId)) return reply.code(400).send({ error: 'Invalid event reference.' });
    const updated = await fastify.prisma.$executeRawUnsafe(
      'UPDATE phonelink_events SET status = $1, acknowledged_at = NOW() WHERE id = $2 AND device_id = $3 AND user_id = $4 AND status = $5',
      'acknowledged', request.params.eventId, request.params.id, request.authUser!.id, 'queued',
    );
    if (!updated) return reply.code(404).send({ error: 'Queued event not found.' });
    return { success: true, status: 'acknowledged' };
  });

  fastify.get('/api/phonelink/capabilities', async () => ({
    capabilities: [
      { id: 'files.receive', label: 'Send files to RyanAI', state: 'storage_adapter_required', approval: 'per upload' },
      { id: 'files.send', label: 'Receive files from RyanAI', state: 'storage_adapter_required', approval: 'per download' },
      { id: 'share.receive', label: 'Android share-sheet intake', state: 'companion_required', approval: 'per share' },
      { id: 'comms.receive', label: 'Receive RyanAI Comms updates', state: 'native_companion_build_pending', approval: 'per device' },
      { id: 'notifications.receive', label: 'Receive RyanAI notifications', state: 'push_provider_required', approval: 'per device' },
      { id: 'voice.upload', label: 'Upload voice notes', state: 'companion_required', approval: 'per recording' },
      { id: 'voice.live', label: 'Live RyanAI voice session', state: 'available', approval: 'explicit start/stop and Android microphone permission per session' },
      { id: 'camera.upload', label: 'Upload camera captures', state: 'companion_required', approval: 'per capture' },
      { id: 'tasks.receive', label: 'Receive Studio task updates', state: 'task_event_adapter_required', approval: 'per device' },
    ],
  }));
};
