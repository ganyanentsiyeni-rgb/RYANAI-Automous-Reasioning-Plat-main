// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metricsRoutes } from './metrics.js';

vi.mock('./auth.js', () => ({
  requireAdmin: async (request: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
  },
}));

describe('administrator runtime metrics', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires administrator authorization', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(metricsRoutes);

    const response = await app.inject({ method: 'GET', url: '/api/admin/metrics' });
    expect(response.statusCode).toBe(403);
  });

  it('returns bounded read-only host and process diagnostics without claiming database readiness', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(metricsRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/metrics',
      headers: { 'x-test-role': 'admin' },
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.status).toBe('available');
    expect(payload.readiness).toBe('not_checked');
    expect(payload.database.status).toBe('unknown');
    expect(payload.timestamp).toBeTruthy();
    expect(Number.isFinite(payload.uptime)).toBe(true);
    expect(payload.system.logicalProcessors).toBeGreaterThan(0);
    expect(payload.system.totalMemoryMB).toBeGreaterThan(0);
    expect(payload.system.freeMemoryMB).toBeGreaterThanOrEqual(0);
    expect(payload.system.rssMemoryMB).toBeGreaterThan(0);
    expect(payload.system.heapUsedMB).toBeGreaterThan(0);
    expect(payload.system.loadAverage).toHaveLength(3);
    expect(Number.isFinite(payload.system.processCpuUserMs)).toBe(true);
    expect(Number.isFinite(payload.system.processCpuSystemMs)).toBe(true);
  });
});
