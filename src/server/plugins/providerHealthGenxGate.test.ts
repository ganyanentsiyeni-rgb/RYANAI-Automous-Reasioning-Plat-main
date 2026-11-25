import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerHealthRoutes } from './providerHealthRoutes.js';
import { encryptProviderCredential } from './providerAuthorization.js';
import * as genxPolicy from '../../security/genxPolicy.js';

const owner = { id: 'health-owner', role: 'user' as const, isOwner: false, actorType: 'human' as const, pluginPreferences: {} };
const key = '5a'.repeat(32);

function fixture() {
  const connection = {
    id: 'connection-1',
    ownerUserId: owner.id,
    providerId: 'gmail',
    status: 'connected',
    revokedAt: null,
    encryptedAccessToken: encryptProviderCredential(
      'synthetic-access-token',
      Buffer.from(key, 'hex'),
      `plugin-token:gmail:${owner.id}`,
    ),
    encryptedRefreshToken: 'synthetic-refresh',
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    connectionMetadata: {},
  };
  const prisma = {
    pluginProviderConnection: {
      findUnique: vi.fn(async () => connection),
      update: vi.fn(async ({ data }: { data: { connectionMetadata: unknown } }) => {
        connection.connectionMetadata = data.connectionMetadata;
        return connection;
      }),
    },
  };
  return { prisma, connection };
}

async function createApp() {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => { request.authUser = owner; });
  const { prisma, connection } = fixture();
  app.decorate('prisma', prisma as unknown as PrismaClient);
  await app.register(providerHealthRoutes);
  return { app, prisma, connection };
}

describe('provider health Gen-X network gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('denies the provider network probe before fetch when Gen-X rejects', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const policy = vi.spyOn(genxPolicy, 'evaluateGenXSecurityEvent').mockReturnValue({
      decision: 'DENY',
      ruleId: 'GX-TEST-DENY',
      reason: 'Test denial',
      severity: 'HIGH',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, prisma } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/api/plugins/gmail/health' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      provider: 'gmail',
      executionStatus: 'blocked_genx',
      usable: false,
    });
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'plugin_provider_read',
      action: 'NETWORK',
      target: 'plugin-provider:gmail:gmail.messages.read',
      principal: owner.id,
      actorType: 'human',
      ownerAuthorized: true,
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.pluginProviderConnection.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows the health probe only after Gen-X permits the exact provider read capability', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const policy = vi.spyOn(genxPolicy, 'evaluateGenXSecurityEvent').mockReturnValue({
      decision: 'ALLOW',
      ruleId: 'GX-OWNER-PLUGIN-READ-001',
      reason: 'Test allow',
      severity: 'LOW',
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await createApp();

    const response = await app.inject({ method: 'GET', url: '/api/plugins/gmail/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'gmail',
      healthStatus: 'healthy',
      executionStatus: 'blocked_adapter_missing',
      usable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({
      target: 'plugin-provider:gmail:gmail.messages.read',
    }));
    await app.close();
  });
});
