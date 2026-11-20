import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireOwner } from './auth.js';
import { backupPreflight, createDatabaseBackup, listDatabaseBackups, recoveryPreflight } from '../../services/adminResilience.js';

interface MaintenanceRequestBody { reason: string; startsAt: string; endsAt: string; }
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
    const id = crypto.randomUUID(); const requestedAt = new Date().toISOString();
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
};
