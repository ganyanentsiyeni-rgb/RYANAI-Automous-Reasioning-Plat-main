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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function createApp(findMany = vi.fn().mockResolvedValue([])) {
    const app = Fastify();
    apps.push(app);
    app.decorate('prisma', { profile: { findMany } } as never);
    return { app, findMany };
  }

  function disableAuthAdmin() {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  }

  it('requires administrator authorization and rejects invalid limits before querying', async () => {
    disableAuthAdmin();
    const { app, findMany } = createApp();
    await app.register(adminUsersRoutes);

    const denied = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(denied.statusCode).toBe(403);

    for (const limit of ['0', '-1', '101', '1.5', 'abc']) {
      const invalid = await app.inject({ method: 'GET', url: '/api/admin/users?limit=' + limit, headers: { 'x-test-role': 'admin' } });
      expect(invalid.statusCode).toBe(400);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid pages before querying', async () => {
    disableAuthAdmin();
    const { app, findMany } = createApp();
    await app.register(adminUsersRoutes);

    for (const page of ['0', '-1', '1.5', 'abc', '100001']) {
      const invalid = await app.inject({ method: 'GET', url: '/api/admin/users?page=' + page, headers: { 'x-test-role': 'admin' } });
      expect(invalid.statusCode).toBe(400);
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bounds search input, selects approved fields and reports the current paginated coverage', async () => {
    disableAuthAdmin();
    const profiles = [{
      id: 'profile-1',
      email: 'person@example.test',
      fullName: 'Test Person',
      createdAt: new Date('2026-11-17T10:00:00Z'),
      updatedAt: new Date('2026-11-18T10:00:00Z'),
    }];
    const { app, findMany } = createApp(vi.fn().mockResolvedValue(profiles));
    await app.register(adminUsersRoutes);

    const longSearch = 'x'.repeat(140);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=25&page=2&search=' + longSearch,
      headers: { 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profiles: [{ ...profiles[0], createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z' }],
      authInventory: { status: 'not_configured', users: [], page: 2, perPage: 25 },
      coverage: 'public.profiles records plus one paginated Supabase Auth Admin page when server credentials are configured.',
      limit: 25,
      page: 2,
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses only a configured server credential for a bounded read-only Auth page and sanitizes returned fields', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-server-secret');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{
          id: 'auth-user-1',
          email: 'auth@example.test',
          created_at: '2026-11-17T10:00:00.000Z',
          last_sign_in_at: '2026-11-18T10:00:00.000Z',
          app_metadata: { role: 'admin', provider: 'google' },
          user_metadata: { privateNote: 'must not be returned' },
          encrypted_password: 'must not be returned',
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createApp();
    await app.register(adminUsersRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=10&page=3',
      headers: { 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authInventory).toEqual({
      status: 'available',
      page: 3,
      perPage: 10,
      users: [{
        id: 'auth-user-1',
        email: 'auth@example.test',
        createdAt: '2026-11-17T10:00:00.000Z',
        lastSignInAt: '2026-11-18T10:00:00.000Z',
        role: 'admin',
      }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.example.test/auth/v1/admin/users?page=3&per_page=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          apikey: 'test-server-secret',
          Authorization: 'Bearer test-server-secret',
        }),
      }),
    );
    expect(JSON.stringify(response.json())).not.toContain('must not be returned');
  });

  it('reports Auth inventory as unavailable without exposing upstream error details', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-server-secret');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { app } = createApp();
    await app.register(adminUsersRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { 'x-test-role': 'admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authInventory).toEqual({
      status: 'unavailable',
      users: [],
      page: 1,
      perPage: 50,
    });
  });
});
