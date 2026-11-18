import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from './auth.js';

interface UserDirectoryQuery {
  limit?: string;
  search?: string;
}

/**
 * Read-only directory of public profile records.
 * This intentionally does not claim to enumerate every Supabase Auth identity:
 * accounts without a corresponding public.profiles row are not represented.
 */
export const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get<{ Querystring: UserDirectoryQuery }>('/api/admin/users', async (request, reply) => {
    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({ error: 'limit must be an integer between 1 and 100.' });
    }

    const search = typeof request.query.search === 'string'
      ? request.query.search.trim().slice(0, 100)
      : '';

    const profiles = await fastify.prisma.profile.findMany({
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      where: search ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { fullName: { contains: search, mode: 'insensitive' } },
        ],
      } : undefined,
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      profiles,
      coverage: 'public.profiles records only; this is not a complete Supabase Auth user inventory.',
      limit,
      search: search || null,
    };
  });
};
