import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin, requireOwner } from './auth.js';
import { backupPreflight, createDatabaseBackup, listDatabaseBackups, recoveryPreflight } from '../../services/adminResilience.js';

interface MaintenanceRequestBody { reason: string; startsAt: string; endsAt: string; }
interface MaintenanceEventDetails { maintenanceId?: string; reason?: string; startsAt?: string; endsAt?: string; requestedAt?: string; closedAt?: string; }
interface MaintenanceEventDetails { maintenanceId?: string; reason?: string; startsAt?: string; endsAt?: string; requestedAt?: string; }

export const adminResilienceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/admin/resilience/status', { preHandler: requireAdmin }, async () => {
    const backup = await backupPreflight();
    return {
      status: 'available',
      generatedAt: new Date().toISOString(),
      online: true,
      backup,
      recovery: recoveryPreflight(),
      selfPatch: {
        status: process.env.RYANAI_GITHUB_TOKEN && process.env.RYANAI_GITHUB_REPOSITORY ? 'configured' : 'not_configured',
        mode: 'isolated-github-pr',
      },
      maintenance: {
        status: 'audit_lifecycle',
        status: 'audited_lifecycle',
        automation: 'disabled',
      },
    };
  });

  fastify.get('/api/admin/resilience/backups', { preHandler: requireAdmin }, async () => {
    return listDatabaseBackups();
  });


  fastify.get('/api/admin/resilience/maintenance', { preHandler: requireAdmin }, async () => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { in: ['admin.resilience.maintenance.requested', 'admin.resilience.maintenance.closed'] } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    const records = new Map<string, { id: string; reason: string; startsAt: string; endsAt: string; status: 'requested' | 'closed'; requestedAt: string }>();
    for (const event of events) {
      const details = event.details as MaintenanceEventDetails;
      const id = details.maintenanceId || event.resourceId;
      if (!id) continue;
      if (event.eventType === 'admin.resilience.maintenance.closed') { const current = records.get(id); if (current) current.status = 'closed'; continue; }
      if (event.eventType === 'admin.resilience.maintenance.requested' && !records.has(id) && details.reason && details.startsAt && details.endsAt) {
        records.set(id, { id, reason: details.reason, startsAt: details.startsAt, endsAt: details.endsAt, status: 'requested', requestedAt: details.requestedAt || event.createdAt.toISOString() });
      }
    }
    return { records: [...records.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) };
  });

  fastify.post<{ Body: MaintenanceRequestBody }>('/api/admin/resilience/maintenance', {
    preHandler: requireOwner, config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: { body: { type: 'object', required: ['reason', 'startsAt', 'endsAt'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 8, maxLength: 500 }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' } } } },
  }, async (request, reply) => {
    const startsAt = Date.parse(request.body.startsAt); const endsAt = Date.parse(request.body.endsAt); const now = Date.now();
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= now || endsAt <= startsAt || endsAt - startsAt > 30 * 24 * 60 * 60 * 1000) return reply.code(400).send({ error: 'Maintenance window must be in the future and no longer than 30 days.' });
    const id = randomUUID(); const requestedAt = new Date().toISOString();
    await fastify.prisma.jarvisAuditEvent.create({ data: { actorId: request.authUser?.id || 'unknown', eventType: 'admin.resilience.maintenance.requested', resourceId: id, details: { maintenanceId: id, reason: request.body.reason.trim(), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), requestedAt, infrastructureChanged: false } } });
    return reply.code(201).send({ success: true, id, status: 'requested', requestedAt });
  });

  fastify.post<{ Params: { id: string } }>('/api/admin/resilience/maintenance/:id/close', {
    preHandler: requireOwner, config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 80 } } } },
  }, async (request, reply) => {
    const existing = await fastify.prisma.jarvisAuditEvent.findFirst({ where: { resourceId: request.params.id, eventType: 'admin.resilience.maintenance.requested' }, orderBy: { createdAt: 'desc' } });
    if (!existing) return reply.code(404).send({ error: 'Maintenance record was not found.' });
    const closed = await fastify.prisma.jarvisAuditEvent.findFirst({ where: { resourceId: request.params.id, eventType: 'admin.resilience.maintenance.closed' } });
    if (closed) return reply.code(409).send({ error: 'Maintenance record is already closed.' });
    await fastify.prisma.jarvisAuditEvent.create({ data: { actorId: request.authUser?.id || 'unknown', eventType: 'admin.resilience.maintenance.closed', resourceId: request.params.id, details: { maintenanceId: request.params.id, closedAt: new Date().toISOString(), infrastructureChanged: false } } });
    return reply.code(200).send({ success: true, id: request.params.id, status: 'closed' });
  });
  fastify.post('/api/admin/resilience/backups', {
    preHandler: requireOwner,
    config: { rateLimit: { max: 1, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const result = await createDatabaseBackup();
    if (result.status === 'succeeded') {
      await fastify.prisma.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser?.id || 'unknown',
          eventType: 'admin.resilience.backup.succeeded',
          resourceId: result.backupId,
          details: {
            prefix: result.prefix,
            databaseBytes: result.databaseBytes,
            databaseSha256: result.databaseSha256,
            secretsIncluded: false,
          },
        },
      });
      return reply.code(202).send({ success: true, result });
    }

    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser?.id || 'unknown',
        eventType: 'admin.resilience.backup.failed',
        resourceId: result.backupId || null,
        details: { reason: result.reason || 'Backup failed.' },
      },
    });
    return reply.code(result.status === 'not_configured' ? 503 : 500).send({ success: false, result });
  });

  fastify.get('/api/admin/resilience/maintenance', { preHandler: requireAdmin }, async () => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { startsWith: 'admin.maintenance.' } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const latest = new Map<string, { id: string; state: string; title: string; startsAt: string | null; endsAt: string | null; updatedAt: string }>();
    for (const event of events) {
      if (!event.resourceId || latest.has(event.resourceId)) continue;
      const details = event.details && typeof event.details === 'object' ? event.details as Record<string, unknown> : {};
      latest.set(event.resourceId, {
        id: event.resourceId,
        state: event.eventType.replace('admin.maintenance.', ''),
        title: typeof details.title === 'string' ? details.title : 'Maintenance window',
        startsAt: typeof details.startsAt === 'string' ? details.startsAt : null,
        endsAt: typeof details.endsAt === 'string' ? details.endsAt : null,
        updatedAt: event.createdAt.toISOString(),
      });
    }
    return { status: 'available', items: Array.from(latest.values()) };
  });

  fastify.post('/api/admin/resilience/maintenance', { preHandler: requireOwner }, async (request, reply) => {
    const body = request.body as { action?: string; id?: string; title?: string; startsAt?: string; endsAt?: string } | null;
    const action = body?.action;
    if (!body || !action || !['scheduled', 'started', 'completed', 'cancelled'].includes(action)) {
      return reply.code(400).send({ error: 'A valid maintenance action is required.' });
    }
    const startsAt = body.startsAt ? Date.parse(body.startsAt) : Number.NaN;
    const endsAt = body.endsAt ? Date.parse(body.endsAt) : Number.NaN;
    if (action === 'scheduled' && (
      !body.title?.trim() || body.title.trim().length > 120 ||
      !Number.isFinite(startsAt) || !Number.isFinite(endsAt) ||
      startsAt <= Date.now() || endsAt <= startsAt || endsAt - startsAt > 30 * 24 * 60 * 60 * 1000
    )) return reply.code(400).send({ error: 'Provide a title, future start and end within 30 days.' });
    if (action !== 'scheduled' && !body.id) return reply.code(400).send({ error: 'A maintenance window ID is required.' });

    const id = action === 'scheduled' ? randomUUID() : body.id!;
    let details: Record<string, unknown>;
    if (action === 'scheduled') {
      details = { title: body.title!.trim(), startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
    } else {
      const prior = await fastify.prisma.jarvisAuditEvent.findFirst({
        where: { resourceId: id, eventType: { startsWith: 'admin.maintenance.' } },
        orderBy: { createdAt: 'desc' },
      });
      if (!prior) return reply.code(404).send({ error: 'Maintenance window not found.' });
      const state = prior.eventType.replace('admin.maintenance.', '');
      const valid = !['completed', 'cancelled'].includes(state) &&
        ((action === 'started' && state === 'scheduled') ||
         (action === 'completed' && state === 'started') ||
         (action === 'cancelled' && ['scheduled', 'started'].includes(state)));
      if (!valid) return reply.code(409).send({ error: 'Invalid maintenance lifecycle transition.' });
      details = prior.details && typeof prior.details === 'object' ? prior.details as Record<string, unknown> : {};
    }
    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser?.id || 'unknown',
        eventType: 'admin.maintenance.' + action,
        resourceId: id,
        details,
      },
    });
    return reply.code(202).send({ success: true, id, state: action });
  });

};
