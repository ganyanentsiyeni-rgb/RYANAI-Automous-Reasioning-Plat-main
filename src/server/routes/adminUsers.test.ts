// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminUsersRoutes } from './adminUsers.js';

vi.mock('./auth.js', () => ({
  requireAdmin: async (request: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
  },
}));

describe('administrator user directory', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires administrator authorization and rejects invalid limits before querying', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = Fastify();
    apps.push(app);
    app.decorate('prisma', { profile: { findMany } } as never);
    await app.register(adminUsersRoutes);

    const denied = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(denied.statusCode).toBe(403);

    for (const limit of ['0', '-1', '101', '1.5', 'abc']) {
      const invalid = await app.inject({ method: 'GET', url: '/api/admin/users?limit=' + limit, headers: { 'x-test-role': 'admin' } });
      expect(invalid.statusCode).toBe(400);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bounds search input and selects only the approved profile fields', async () => {
    const profiles = [{
      id: 'profile-1',
      email: 'person@example.test',
      fullName: 'Test Person',
      createdAt: new Date('2026-11-17T10:00:00Z'),
      updatedAt: new Date('2026-11-18T10:00:00Z'),
    }];
    const findMany = vi.fn().mockResolvedValue(profiles);
    const app = Fastify();
    apps.push(app);
    app.decorate('prisma', { profile: { findMany } } as never);
    await app.register(adminUsersRoutes);

    const longSearch = 'x'.repeat(140);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=25&search=' + longSearch,
      headers: { 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profiles: [{ ...profiles[0], createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z' }],
      coverage: 'public.profiles records only; this is not a complete Supabase Auth user inventory.',
      limit: 25,
      search: 'x'.repeat(100),
    });
    expect(findMany).toHaveBeenCalledWith({
      take: 25,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      where: {
        OR: [
          { email: { contains: 'x'.repeat(100), mode: 'insensitive' } },
          { fullName: { contains: 'x'.repeat(100), mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, fullName: true, createdAt: true, updatedAt: true },
    });
  });
});
