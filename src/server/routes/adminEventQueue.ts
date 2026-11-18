import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from './auth.js';
import { IntelligenceEventInbox } from '../../events/intelligenceEventInbox.js';

/** Read-only queue health; never returns event payloads or error text. */
export const adminEventQueueRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);
  fastify.get('/api/admin/events/queue-health', async () => {
    const inbox = new IntelligenceEventInbox(fastify.prisma);
    const counts = await inbox.statusCounts();
    return {
      queue: counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      worker: {
        activation: process.env.INTELLIGENCE_EVENT_WORKER_ENABLED === 'true' ? 'opted_in' : 'disabled',
        note: 'Worker also requires at least one trusted server-registered event handler.',
      },
    };
  });
};
