import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from './auth.js';

interface UserDirectoryQuery {
  limit?: string;
  search?: string;
  page?: string;
}

interface AuthDirectoryUser {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  role: string | null;
}

function authAdminConfiguration() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
    return { url: parsed.origin, secret };
  } catch {
    return null;
  }
}

/**
 * Read-only directory combining public profile rows with one optional,
 * paginated Supabase Auth Admin page. No Auth mutation methods are exposed.
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
    const rawPage = request.query.page;
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      return reply.code(400).send({ error: 'page must be an integer between 1 and 100000.' });
    }

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

    let authInventory: {
      status: 'available' | 'not_configured' | 'unavailable';
      users: AuthDirectoryUser[];
      page: number;
      perPage: number;
    } = { status: 'not_configured', users: [], page, perPage: limit };
    const adminConfig = authAdminConfiguration();
    if (adminConfig) {
      try {
        const response = await fetch(
          adminConfig.url + '/auth/v1/admin/users?page=' + page + '&per_page=' + limit,
          {
            method: 'GET',
            headers: {
              apikey: adminConfig.secret,
              Authorization: 'Bearer ' + adminConfig.secret,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (response.ok) {
          const payload = await response.json() as { users?: Array<Record<string, unknown>> };
          if (!Array.isArray(payload.users)) throw new Error('Supabase Auth Admin returned an invalid user page.');
          const users = payload.users;
          authInventory = {
            status: 'available',
            page,
            perPage: limit,
            users: users.flatMap((user): AuthDirectoryUser[] => {
              if (typeof user.id !== 'string') return [];
              const appMetadata = user.app_metadata && typeof user.app_metadata === 'object'
                ? user.app_metadata as Record<string, unknown>
                : {};
              return [{
                id: user.id,
                email: typeof user.email === 'string' ? user.email : null,
                createdAt: typeof user.created_at === 'string' ? user.created_at : null,
                lastSignInAt: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
                role: typeof appMetadata.role === 'string' ? appMetadata.role : null,
              }];
            }),
          };
        } else {
          authInventory.status = 'unavailable';
        }
      } catch {
        authInventory.status = 'unavailable';
      }
    }

    return {
      profiles,
      authInventory,
      coverage: 'public.profiles records plus one paginated Supabase Auth Admin page when server credentials are configured.',
      limit,
      page,
      search: search || null,
    };
  });
};
