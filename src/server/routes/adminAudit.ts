import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from './auth.js';

interface AuditQuery {
  limit?: string;
}

/**
 * Read-only, administrator-protected audit feed.
 * Deliberately excludes free-form details JSON because historical events may
 * contain user content or sensitive operational payloads.
 */
export const adminAuditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get<{ Querystring: AuditQuery }>('/api/admin/audit-events', async (request, reply) => {
    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ error: 'limit must be an integer between 1 and 100.' });
    }

    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        actorId: true,
        eventType: true,
        resourceId: true,
        createdAt: true,
      },
    });
    return { events };
  });
};
