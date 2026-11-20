import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAdmin, requireOwner } from './auth.js';
import { backupPreflight, createDatabaseBackup, listDatabaseBackups, recoveryPreflight } from '../../services/adminResilience.js';

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
        automation: 'disabled',
      },
    };
  });

  fastify.get('/api/admin/resilience/backups', { preHandler: requireAdmin }, async () => {
    return listDatabaseBackups();
  });


  fastify.get('/api/admin/resilience/maintenance', { preHandler: requireAdmin }, async () => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { in: ['admin.maintenance.requested', 'admin.maintenance.cancelled'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const latest = new Map<string, typeof events[number]>();
    for (const event of events) {
      if (event.resourceId && !latest.has(event.resourceId)) latest.set(event.resourceId, event);
    }
    return {
      status: 'available',
      automation: 'disabled',
      activation: 'not_connected',
      requests: [...latest.values()]
        .filter((event) => event.eventType === 'admin.maintenance.requested')
        .map((event) => ({
          id: event.resourceId,
          actorId: event.actorId,
          createdAt: event.createdAt,
          ...(event.details as Record<string, unknown>),
        })),
    };
  });

  fastify.post('/api/admin/resilience/maintenance', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as { summary?: unknown; startsAt?: unknown; endsAt?: unknown } | null;
    const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
    const startsAt = typeof body?.startsAt === 'string' ? body.startsAt : '';
    const endsAt = typeof body?.endsAt === 'string' ? body.endsAt : '';
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    const duration = end - start;
    if (!summary || summary.length > 120 || !Number.isFinite(start) || !Number.isFinite(end)
      || duration <= 0 || duration > 7 * 24 * 60 * 60 * 1000) {
      return reply.code(400).send({ success: false, error: 'Provide a summary (1–120 characters) and a valid maintenance window no longer than 7 days.' });
    }
    const id = randomUUID();
    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser?.id || 'unknown',
        eventType: 'admin.maintenance.requested',
        resourceId: id,
        details: { summary, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), status: 'requested' },
      },
    });
    return reply.code(201).send({ success: true, request: { id, summary, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), status: 'requested' } });
  });

  fastify.post('/api/admin/resilience/maintenance/:id/cancel', { preHandler: requireOwner }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || id.length > 128) return reply.code(400).send({ success: false, error: 'Invalid maintenance request ID.' });
    const existing = await fastify.prisma.jarvisAuditEvent.findFirst({
      where: { resourceId: id, eventType: 'admin.maintenance.requested' },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) return reply.code(404).send({ success: false, error: 'Maintenance request not found.' });
    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser?.id || 'unknown',
        eventType: 'admin.maintenance.cancelled',
        resourceId: id,
        details: { status: 'cancelled', reason: 'owner_cancelled' },
      },
    });
    return reply.code(200).send({ success: true, id, status: 'cancelled' });
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
