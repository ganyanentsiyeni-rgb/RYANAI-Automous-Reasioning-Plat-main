import type { FastifyInstance } from 'fastify';

const retiredResponse = {
  success: false,
  error: 'Gone',
  message: 'Local password/JWT authentication has been retired. Use Supabase Auth through the RyanAI sign-in page.',
};

/**
 * Compatibility-only routes for any obsolete server composition that still
 * imports this module. Never create a second Prisma/JWT identity alongside
 * Supabase Auth.
 */
export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/signup', async (_request, reply) =>
    reply.code(410).send(retiredResponse),
  );
  fastify.post('/api/auth/signin', async (_request, reply) =>
    reply.code(410).send(retiredResponse),
  );
  fastify.get('/api/auth/me', async (_request, reply) =>
    reply.code(410).send(retiredResponse),
  );
}
