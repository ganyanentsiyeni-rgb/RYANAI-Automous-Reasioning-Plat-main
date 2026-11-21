import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('retired legacy Prisma/JWT routes', () => {
  it.each([
    ['POST', '/api/auth/signup'],
    ['POST', '/api/auth/signin'],
    ['GET', '/api/auth/me'],
  ] as const)('%s %s cannot issue or accept a local JWT session', async (method, url) => {
    const app = Fastify();
    apps.push(app);
    await registerAuthRoutes(app);
    await app.ready();

    const response = await app.inject({ method, url, payload: { email: 'user@example.test', password: 'not-a-real-password' } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({
      success: false,
      error: 'Gone',
    });
    expect(response.json().message).toContain('Supabase Auth');
  });
});
