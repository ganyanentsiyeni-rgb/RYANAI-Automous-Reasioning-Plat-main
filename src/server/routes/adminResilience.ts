import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireOwner } from './auth.js';
import { backupPreflight, createDatabaseBackup } from '../../services/adminResilience.js';

export const adminResilienceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/admin/resilience/status', { preHandler: requireAdmin }, async () => {
    const backup = await backupPreflight();
    return {
      status: 'available',
      generatedAt: new Date().toISOString(),
      online: true,
      backup,
      recovery: {
        status: process.env.RYANAI_RECOVERY_DATABASE_URL ? 'configured' : 'not_configured',
        productionRestore: 'disabled',
        drillTarget: process.env.RYANAI_RECOVERY_TARGET_LABEL || null,
      },
      selfPatch: {
        status: process.env.RYANAI_GITHUB_TOKEN && process.env.RYANAI_GITHUB_REPOSITORY ? 'configured' : 'not_configured',
        mode: 'isolated-github-pr',
      },
      maintenance: {
        status: 'request_only',
        automation: 'disabled',
      },
    };
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
