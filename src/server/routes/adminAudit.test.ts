// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminAuditRoutes } from './adminAudit.js';

vi.mock('./auth.js', () => ({
  requireAdmin: async (request: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
  },
}));

describe('administrator audit feed', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns newest audit metadata only and enforces a bounded page size', async () => {
    const events = [{ id: 'event-1', actorId: 'actor-1', eventType: 'policy.check', resourceId: null, createdAt: new Date('2026-11-17T10:00:00Z') }];
    const findMany = vi.fn().mockResolvedValue(events);
    const app = Fastify();
    apps.push(app);
    app.decorate('prisma', { jarvisAuditEvent: { findMany } } as never);
    await app.register(adminAuditRoutes);

    const denied = await app.inject({ method: 'GET', url: '/api/admin/audit-events' });
    expect(denied.statusCode).toBe(403);

    const invalid = await app.inject({ method: 'GET', url: '/api/admin/audit-events?limit=101', headers: { 'x-test-role': 'admin' } });
    expect(invalid.statusCode).toBe(400);
    expect(findMany).not.toHaveBeenCalled();

    const response = await app.inject({ method: 'GET', url: '/api/admin/audit-events?limit=25', headers: { 'x-test-role': 'admin' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events: [{ ...events[0], createdAt: '2026-11-17T10:00:00.000Z' }] });
    expect(findMany).toHaveBeenCalledWith({
      take: 25,
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorId: true, eventType: true, resourceId: true, createdAt: true },
    });
  });
});
