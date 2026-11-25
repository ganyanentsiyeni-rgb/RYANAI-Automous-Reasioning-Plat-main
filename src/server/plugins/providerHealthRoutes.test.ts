import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerHealthRoutes } from './providerHealthRoutes.js';
import { encryptProviderCredential } from './providerAuthorization.js';

const owner = { id: 'provider-health-owner', role: 'user' as const, isOwner: false, actorType: 'human' as const, pluginPreferences: {} };
const key = '5a'.repeat(32);

function createFixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    pluginProviderConnection: {
      findUnique: vi.fn(async ({ where }: { where: { ownerUserId_providerId: { ownerUserId: string; providerId: string } } }) =>
        rows.get(`${where.ownerUserId_providerId.ownerUserId}:${where.ownerUserId_providerId.providerId}`) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { connectionMetadata: unknown } }) => {
        for (const row of rows.values()) {
          if (row.id === where.id) {
            row.connectionMetadata = data.connectionMetadata;
            return row;
          }
        }
        throw new Error('connection not found');
      }),
    },
  };
  return { prisma, rows };
}

async function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => { request.authUser = owner; });
  const fixture = createFixture();
  app.decorate('prisma', fixture.prisma as unknown as PrismaClient);
  await app.register(providerHealthRoutes);
  return { app, ...fixture };
}

describe('authenticated provider health HTTP boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails closed when no owner connection exists', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/api/plugins/gmail/health' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      provider: 'gmail',
      healthStatus: 'not_probed',
      executionStatus: 'blocked_connection',
      usable: false,
    });
    await app.close();
  });

  it('rejects unsupported provider probes without contacting an external provider', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/api/plugins/not-supported/health' });

    expect(response.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('probes the owner connection, persists redacted health evidence, and reports readiness only when healthy', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app, rows, prisma } = await createApp();
    const encrypted = encryptProviderCredential(
      'synthetic-gmail-access-token',
      Buffer.from(key, 'hex'),
      `plugin-token:gmail:${owner.id}`,
    );
    rows.set(`${owner.id}:gmail`, {
      id: 'gmail-connection',
      ownerUserId: owner.id,
      providerId: 'gmail',
      status: 'connected',
      encryptedAccessToken: encrypted,
      encryptedRefreshToken: 'encrypted-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      connectionMetadata: { existing: 'preserved' },
    });

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-gmail-access-token');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({ method: 'GET', url: '/api/plugins/gmail/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'gmail',
      healthStatus: 'healthy',
      adapterStatus: 'adapter_required',
      executionStatus: 'blocked_adapter_missing',
      usable: false,
    });
    expect(response.body).not.toContain('synthetic-gmail-access-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(prisma.pluginProviderConnection.update).toHaveBeenCalledOnce();
    expect(rows.get(`${owner.id}:gmail`)?.connectionMetadata).toMatchObject({
      existing: 'preserved',
      health: { status: 'healthy' },
    });
    await app.close();
  });

  it('persists unavailable health and keeps execution blocked after provider authorization rejection', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app, rows } = await createApp();
    rows.set(`${owner.id}:google-calendar`, {
      id: 'calendar-connection',
      ownerUserId: owner.id,
      providerId: 'google-calendar',
      status: 'connected',
      encryptedAccessToken: encryptProviderCredential(
        'synthetic-calendar-access-token',
        Buffer.from(key, 'hex'),
        `plugin-token:google-calendar:${owner.id}`,
      ),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      connectionMetadata: {},
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    const response = await app.inject({ method: 'GET', url: '/api/plugins/google-calendar/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'google-calendar',
      healthStatus: 'unavailable',
      executionStatus: 'blocked_adapter_missing',
      usable: false,
    });
    expect(rows.get(`${owner.id}:google-calendar`)?.connectionMetadata).toMatchObject({
      health: { status: 'unavailable' },
    });
    await app.close();
  });
});
