import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerAuthorizationRoutes } from './providerAuthorizationRoutes.js';
import { encryptProviderCredential } from './providerAuthorization.js';
import * as genxPolicy from '../../security/genxPolicy.js';

const owner = {
  id: 'owner-user-1',
  role: 'user' as const,
  isOwner: true,
  pluginPreferences: {
    'google-calendar': { enabled: true, scopes: [] },
    'microsoft-365-calendar': { enabled: true, scopes: [] },
    gmail: { enabled: true, scopes: [] },
  },
};
const key = '5a'.repeat(32);

function createPrismaFixture() {
  const stateRows = new Map<string, Record<string, unknown>>();
  const connectionRows = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const prisma = {
    pluginOAuthState: {
      deleteMany: vi.fn(async ({ where }: { where?: { stateHash?: string; expiresAt?: { lte?: Date; gt?: Date }; providerId?: string } }) => {
        if (where?.stateHash) {
          const row = stateRows.get(where.stateHash);
          if (row && (!where.expiresAt?.gt || (row.expiresAt as Date) > where.expiresAt.gt)) {
            stateRows.delete(where.stateHash);
            return { count: 1 };
          }
          return { count: 0 };
        }
        return { count: 0 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stateRows.set(String(data.stateHash), data);
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) => stateRows.get(where.stateHash) ?? null),
    },
    pluginProviderConnection: {
      findUnique: vi.fn(async ({ where }: { where: { ownerUserId_providerId: { ownerUserId: string; providerId: string } } }) =>
        connectionRows.get(`${where.ownerUserId_providerId.ownerUserId}:${where.ownerUserId_providerId.providerId}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { ownerUserId_providerId: { ownerUserId: string; providerId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const id = `${where.ownerUserId_providerId.ownerUserId}:${where.ownerUserId_providerId.providerId}`;
        const previous = connectionRows.get(id);
        const row = { id: 'connection-1', ...previous, ...(previous ? update : create) };
        connectionRows.set(id, row);
        return row;
      }),
      findMany: vi.fn(async ({ where, select }: { where: { ownerUserId: string }; select?: Record<string, boolean> }) =>
        [...connectionRows.values()]
          .filter((row) => row.ownerUserId === where.ownerUserId)
          .map((row) => select
            ? Object.fromEntries(Object.entries(select).filter(([, include]) => include).map(([field]) => [field, row[field]]))
            : row)),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    pluginAuthorizationEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; }),
    },
  };
  return { prisma, stateRows, connectionRows, events };
}

async function createApp(authUser = owner) {
  const app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => { request.authUser = authUser; });
  const fixture = createPrismaFixture();
  app.decorate('prisma', fixture.prisma as unknown as PrismaClient);
  await app.register(providerAuthorizationRoutes);
  return { app, ...fixture };
}

describe('provider authorization HTTP lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts Google Calendar OAuth using server configuration and least-privilege read-only scope', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, stateRows } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/connect' });
    expect(response.statusCode).toBe(200);
    const result = response.json() as { authorizationUrl: string; expiresInSeconds: number };
    const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(result.expiresInSeconds).toBe(600);
    expect(prisma.pluginOAuthState.create).toHaveBeenCalledOnce();
    expect(stateRows.size).toBe(1);
    const saved = [...stateRows.values()][0];
    expect(saved.ownerUserId).toBe(owner.id);
    expect(saved).not.toHaveProperty('state');
    expect(saved).not.toHaveProperty('codeVerifier');
    await app.close();
  });

  it('requests Microsoft offline access but requires only returned API scopes', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/plugins/microsoft-365-calendar/connect' });
    expect(response.statusCode).toBe(200);
    const url = new URL((response.json() as { authorizationUrl: string }).authorizationUrl);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('scope')).toContain('Calendars.Read');
    await app.close();
  });

  it('exchanges a one-time callback, validates scopes and stores encrypted tokens', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, stateRows, connectionRows, events } = await createApp();
    const start = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/connect' });
    const state = new URL((start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get('state')!;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'synthetic-access-token',
      token_type: 'Bearer',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const callback = await app.inject({
      method: 'GET',
      url: `/api/plugins/oauth/google-calendar/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json()).toMatchObject({ connected: true, provider: 'google-calendar' });
    const saved = connectionRows.get(`${owner.id}:google-calendar`)!;
    expect(saved.status).toBe('connected');
    expect(saved.encryptedAccessToken).not.toContain('synthetic-access-token');
    expect(saved.encryptedRefreshToken).not.toContain('synthetic-refresh-token');
    expect(events.some((event) => event.eventType === 'authorization_completed')).toBe(true);
    expect(stateRows.size).toBe(0);
    const replay = await app.inject({
      method: 'GET',
      url: `/api/plugins/oauth/google-calendar/callback?code=synthetic-code&state=${encodeURIComponent(state)}`,
    });
    expect(replay.statusCode).toBe(400);
    await app.close();
  });

  it('refreshes only the signed-in owner connection and persists rotated encrypted tokens', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows, events } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'rotated-access-token',
      token_type: 'Bearer',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ refreshed: true, provider: 'google-calendar' });
    expect(prisma.pluginProviderConnection.updateMany).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.encryptedAccessToken).not.toContain('rotated-access-token');
    expect(updateArgs.data.encryptedRefreshToken).not.toContain('rotated-refresh-token');
    expect(events.some((event) => event.eventType === 'token_refreshed')).toBe(true);
    await app.close();
  });

  it('preserves an active connection when provider refresh is temporarily unavailable', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503 })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('existing connection has been preserved');
    expect(prisma.pluginProviderConnection.updateMany).not.toHaveBeenCalled();
    expect(connectionRows.get(`${owner.id}:google-calendar`)?.status).toBe('connected');
    await app.close();
  });

  it('requires reauthorization only when provider explicitly invalidates the refresh grant', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, prisma, connectionRows } = await createApp();
    const refreshCipher = encryptProviderCredential(
      'synthetic-refresh-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1:refresh',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedRefreshToken: refreshCipher,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/refresh' });
    expect(response.statusCode).toBe(409);
    expect(prisma.pluginProviderConnection.updateMany).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.status).toBe('reauthorization_required');
    await app.close();
  });

  it('purges local Microsoft tokens and reports remote revocation as pending when unsupported', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app, prisma, connectionRows, events } = await createApp();
    connectionRows.set(`${owner.id}:microsoft-365-calendar`, {
      id: 'connection-2', ownerUserId: owner.id, providerId: 'microsoft-365-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext', encryptedRefreshToken: 'ciphertext',
    });
    const response = await app.inject({ method: 'POST', url: '/api/plugins/microsoft-365-calendar/disconnect' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      disconnected: true, localCredentialsPurged: true, remoteRevocation: 'pending',
    });
    expect(prisma.pluginProviderConnection.update).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.encryptedAccessToken).toBeNull();
    expect(updateArgs.data.encryptedRefreshToken).toBeNull();
    expect(updateArgs.data.status).toBe('revocation_pending');
    expect(events.some((event) => event.eventType === 'revocation_pending')).toBe(true);
    await app.close();
  });

  it('purges local credentials even when provider configuration is unavailable', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app, prisma, connectionRows, events } = await createApp();
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-3', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext', encryptedRefreshToken: 'ciphertext',
    });
    const response = await app.inject({ method: 'POST', url: '/api/plugins/google-calendar/disconnect' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      disconnected: true, localCredentialsPurged: true, remoteRevocation: 'pending',
    });
    expect(prisma.pluginProviderConnection.update).toHaveBeenCalledOnce();
    const updateArgs = (prisma.pluginProviderConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.encryptedAccessToken).toBeNull();
    expect(updateArgs.data.encryptedRefreshToken).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({
      providerId: 'google-calendar',
      eventType: 'revocation_pending',
    }));
    await app.close();
  });

  it('does not expose credentials through the owner connection listing', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const { app, connectionRows } = await createApp();
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'connection-1', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext', encryptedRefreshToken: 'ciphertext',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['calendar.readonly'], connectedAt: new Date(),
    });
    const response = await app.inject({ method: 'GET', url: '/api/plugins/connections' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('encryptedAccessToken');
    expect(response.body).not.toContain('encryptedRefreshToken');
    expect(response.body).not.toContain('ciphertext');
    expect(response.json()).toMatchObject({
      connections: [{
        providerId: 'google-calendar',
        connectionState: 'connected',
        credentialState: 'access_token_valid_or_expiry_unknown',
        healthState: 'not_probed',
        lastHealthCheckAt: null,
      }],
    });
    await app.close();
  });

  it('reads only the signed-in owner Google Calendar events and returns normalized metadata', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, connectionRows } = await createApp();
    const encrypted = encryptProviderCredential(
      'synthetic-calendar-access-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'calendar-connection', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: encrypted,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://www.googleapis.com');
      expect(url.pathname).toBe('/calendar/v3/calendars/primary/events');
      expect(url.searchParams.get('maxResults')).toBe('20');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-calendar-access-token');
      return new Response(JSON.stringify({ items: [{
        id: 'event-1', summary: 'RyanAI planning', start: { dateTime: '2026-11-18T10:00:00Z' },
        end: { dateTime: '2026-11-18T10:30:00Z' }, location: 'Johannesburg',
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({
      method: 'GET',
      url: '/api/plugins/google-calendar/events?start=2026-11-18T00:00:00Z&end=2026-11-19T00:00:00Z&limit=20',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'google-calendar',
      events: [{ id: 'event-1', title: 'RyanAI planning', location: 'Johannesburg' }],
    });
    expect(response.body).not.toContain('synthetic-calendar-access-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it('reads only the signed-in owner Microsoft 365 calendar events and normalizes Graph metadata', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app, connectionRows } = await createApp();
    const encrypted = encryptProviderCredential(
      'synthetic-microsoft-calendar-access-token', Buffer.from(key, 'hex'),
      'plugin-token:microsoft-365-calendar:owner-user-1',
    );
    connectionRows.set(`${owner.id}:microsoft-365-calendar`, {
      id: 'ms-calendar-connection', ownerUserId: owner.id, providerId: 'microsoft-365-calendar',
      status: 'connected', encryptedAccessToken: encrypted,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['User.Read', 'Calendars.Read'],
    });
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://graph.microsoft.com');
      expect(url.pathname).toBe('/v1.0/me/calendarView');
      expect(url.searchParams.get('startDateTime')).toBe('2026-11-18T00:00:00.000Z');
      expect(url.searchParams.get('endDateTime')).toBe('2026-11-19T00:00:00.000Z');
      expect(url.searchParams.get('$top')).toBe('15');
      expect(url.searchParams.get('$orderby')).toBe('start/dateTime');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-microsoft-calendar-access-token');
      return new Response(JSON.stringify({ value: [{
        id: 'graph-event-1', subject: 'Architecture review',
        start: { dateTime: '2026-11-18T10:00:00.0000000', timeZone: 'South Africa Standard Time' },
        end: { dateTime: '2026-11-18T10:45:00.0000000', timeZone: 'South Africa Standard Time' },
        location: { displayName: 'Johannesburg office' },
        organizer: { emailAddress: { name: 'RyanAI owner', address: 'owner@example.test' } },
        showAs: 'busy',
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({
      method: 'GET',
      url: '/api/plugins/microsoft-365-calendar/events?start=2026-11-18T00:00:00Z&end=2026-11-19T00:00:00Z&limit=15',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'microsoft-365-calendar',
      events: [{
        id: 'graph-event-1', title: 'Architecture review',
        start: '2026-11-18T10:00:00.0000000', end: '2026-11-18T10:45:00.0000000',
        location: 'Johannesburg office', organizer: 'owner@example.test',
      }],
    });
    expect(response.body).not.toContain('synthetic-microsoft-calendar-access-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    await app.close();
  });
  it('rejects Microsoft calendar reads when the owner has not granted Calendars.Read', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app, connectionRows } = await createApp();
    connectionRows.set(`${owner.id}:microsoft-365-calendar`, {
      id: 'ms-calendar-connection', ownerUserId: owner.id, providerId: 'microsoft-365-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext',
      accessTokenExpiresAt: new Date(Date.now() + 60_000), grantedScopes: ['User.Read'],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/microsoft-365-calendar/events?start=2026-11-18T00:00:00Z&end=2026-11-19T00:00:00Z' });
    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not call Microsoft Graph with an expired calendar access token', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_ID', 'synthetic-ms-client');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_CLIENT_SECRET', 'synthetic-ms-secret');
    vi.stubEnv('RYANAI_PLUGIN_MICROSOFT_365_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/microsoft-365-calendar/callback');
    const { app, connectionRows } = await createApp();
    connectionRows.set(`${owner.id}:microsoft-365-calendar`, {
      id: 'ms-calendar-connection', ownerUserId: owner.id, providerId: 'microsoft-365-calendar',
      status: 'connected', encryptedAccessToken: 'ciphertext',
      accessTokenExpiresAt: new Date(Date.now() - 60_000), grantedScopes: ['User.Read', 'Calendars.Read'],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/microsoft-365-calendar/events?start=2026-11-18T00:00:00Z&end=2026-11-19T00:00:00Z' });
    expect(response.statusCode).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
  it('rejects calendar event requests with invalid or excessive date ranges', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app } = await createApp();
    const invalid = await app.inject({ method: 'GET', url: '/api/plugins/google-calendar/events?start=not-a-date' });
    const excessive = await app.inject({
      method: 'GET',
      url: '/api/plugins/google-calendar/events?start=2026-01-01T00:00:00Z&end=2026-03-01T00:00:00Z',
    });
    expect(invalid.statusCode).toBe(400);
    expect(excessive.statusCode).toBe(400);
    await app.close();
  });


  it('reads only owner Gmail message metadata with the read-only scope and never returns credentials', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_ID', 'synthetic-gmail-client');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_SECRET', 'synthetic-gmail-secret');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/gmail/callback');
    const { app, connectionRows } = await createApp();
    const encrypted = encryptProviderCredential(
      'synthetic-gmail-access-token', Buffer.from(key, 'hex'),
      'plugin-token:gmail:owner-user-1',
    );
    connectionRows.set(`${owner.id}:gmail`, {
      id: 'gmail-connection', ownerUserId: owner.id, providerId: 'gmail',
      status: 'connected', encryptedAccessToken: encrypted,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://gmail.googleapis.com');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-gmail-access-token');
      if (url.pathname.endsWith('/messages')) {
        expect(url.searchParams.get('maxResults')).toBe('5');
        expect(url.searchParams.get('q')).toBe('from:owner@example.test');
        return new Response(JSON.stringify({ messages: [{ id: 'message-1', threadId: 'thread-1' }] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      expect(url.pathname).toBe('/gmail/v1/users/me/messages/message-1');
      expect(url.searchParams.get('format')).toBe('metadata');
      expect(url.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
      return new Response(JSON.stringify({
        id: 'message-1', threadId: 'thread-1', snippet: 'A short preview',
        internalDate: '1795000000000',
        payload: { headers: [
          { name: 'From', value: 'Owner <owner@example.test>' },
          { name: 'Subject', value: 'RyanAI review' },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({
      method: 'GET',
      url: '/api/plugins/gmail/messages?q=from%3Aowner%40example.test&limit=5',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'gmail',
      messages: [{
        id: 'message-1', threadId: 'thread-1', snippet: 'A short preview',
        from: 'Owner <owner@example.test>', subject: 'RyanAI review',
      }],
    });
    expect(response.body).not.toContain('synthetic-gmail-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects Gmail message retrieval without the read-only scope before contacting Google', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_ID', 'synthetic-gmail-client');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_SECRET', 'synthetic-gmail-secret');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/gmail/callback');
    const { app, connectionRows } = await createApp();
    connectionRows.set(`${owner.id}:gmail`, {
      id: 'gmail-connection', ownerUserId: owner.id, providerId: 'gmail',
      status: 'connected', encryptedAccessToken: 'ciphertext',
      accessTokenExpiresAt: new Date(Date.now() + 60_000), grantedScopes: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/gmail/messages' });
    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('starts Gmail OAuth with only the Gmail read-only scope', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_ID', 'synthetic-gmail-client');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_CLIENT_SECRET', 'synthetic-gmail-secret');
    vi.stubEnv('RYANAI_PLUGIN_GMAIL_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/gmail/callback');
    const { app } = await createApp();
    const response = await app.inject({ method: 'POST', url: '/api/plugins/gmail/connect' });
    expect(response.statusCode).toBe(200);
    const url = new URL((response.json() as { authorizationUrl: string }).authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    await app.close();
  });
  it('treats authenticated connection ownership separately from the RyanAI global-owner flag', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    const authenticatedUser = { ...owner, isOwner: false };
    const { app, connectionRows } = await createApp(authenticatedUser);
    const encrypted = encryptProviderCredential(
      'synthetic-calendar-access-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1',
    );
    connectionRows.set(`${authenticatedUser.id}:google-calendar`, {
      id: 'calendar-connection', ownerUserId: authenticatedUser.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: encrypted,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const policy = vi.spyOn(genxPolicy, 'evaluateGenXSecurityEvent').mockReturnValue({
      decision: 'ALLOW', ruleId: 'GX-OWNER-PLUGIN-READ-001', reason: 'Test allow', severity: 'LOW',
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/google-calendar/events' });
    expect(response.statusCode).not.toBe(403);
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({
      principal: authenticatedUser.id,
      actorType: 'human',
      ownerAuthorized: true,
    }));
    expect(authenticatedUser.isOwner).toBe(false);
    policy.mockRestore();
    await app.close();
  });

  it('blocks provider network reads when Gen-X denies before contacting the provider', async () => {
    vi.stubEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY', key);
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_ID', 'synthetic-client');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('RYANAI_PLUGIN_GOOGLE_CALENDAR_REDIRECT_URI', 'https://api.example.test/api/plugins/oauth/google-calendar/callback');
    const { app, connectionRows } = await createApp();
    const encrypted = encryptProviderCredential(
      'synthetic-calendar-access-token', Buffer.from(key, 'hex'),
      'plugin-token:google-calendar:owner-user-1',
    );
    connectionRows.set(`${owner.id}:google-calendar`, {
      id: 'calendar-connection', ownerUserId: owner.id, providerId: 'google-calendar',
      status: 'connected', encryptedAccessToken: encrypted,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const policy = vi.spyOn(genxPolicy, 'evaluateGenXSecurityEvent').mockReturnValue({
      decision: 'DENY', ruleId: 'GX-TEST-DENY', reason: 'Test denial', severity: 'HIGH',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'GET', url: '/api/plugins/google-calendar/events' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'Gen-X denied this provider read request.' });
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'plugin_provider_read', action: 'NETWORK',
      target: 'plugin-provider:google-calendar:calendar.events.read',
      actorType: 'human', ownerAuthorized: true, principal: owner.id,
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    policy.mockRestore();
    await app.close();
  });

});
