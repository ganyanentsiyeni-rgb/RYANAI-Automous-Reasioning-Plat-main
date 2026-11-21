import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireUser } from './auth.js';

const mocks = vi.hoisted(() => ({ createContextClient: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock('@supabase/server/core', () => ({ createContextClient: mocks.createContextClient }));

const userId = '123e4567-e89b-12d3-a456-426614174000';
const apps: FastifyInstance[] = [];

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key';
  mocks.getUser.mockResolvedValue({
    data: { user: { id: userId, email: 'person@example.test', is_anonymous: false, app_metadata: {}, user_metadata: {} } },
    error: null,
  });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: userId, aal: 'aal2', session_id: 'session-123' } },
    error: null,
  });
  mocks.createContextClient.mockReturnValue({
    auth: { getUser: mocks.getUser, getClaims: mocks.getClaims },
  });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  vi.clearAllMocks();
});

async function authenticate() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.get('/private', { preHandler: requireUser }, async request => ({ authUser: request.authUser }));
  return app.inject({ method: 'GET', url: '/private', headers: { authorization: 'Bearer verified-user-access-token' } });
}

describe('Supabase session assurance on the backend', () => {
  it('attaches aal2 only from verified Supabase claims', async () => {
    const response = await authenticate();
    expect(response.statusCode).toBe(200);
    expect(response.json().authUser).toMatchObject({ id: userId, sessionAssurance: 'aal2' });
  });

  it('preserves aal1 as aal1 rather than upgrading it from a Twilio-style verification', async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: userId, aal: 'aal1' } }, error: null,
    });
    const response = await authenticate();
    expect(response.statusCode).toBe(200);
    expect(response.json().authUser.sessionAssurance).toBe('aal1');
  });

  it('rejects claims whose subject does not match the Supabase user', async () => {
    const context = mocks.createContextClient.mock.results[0]?.value;
    if (context) context.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: 'different-user', aal: 'aal2' } }, error: null,
    });
    const response = await authenticate();
    expect(response.statusCode).toBe(401);
  });

  it('fails closed when verified claims are unavailable', async () => {
    const context = mocks.createContextClient.mock.results[0]?.value;
    if (context) context.auth.getClaims.mockResolvedValue({ data: null, error: { status: 503 } });
    const response = await authenticate();
    expect(response.statusCode).toBe(503);
  });
});
