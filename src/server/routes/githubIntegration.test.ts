import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptGitHubSecret,
  encryptGitHubSecret,
  GITHUB_APP_REPOSITORY,
} from '../githubAppOAuth.js';
import { githubIntegrationRoutes, inspectConnectedGitHubRepository, inspectConnectedGitHubWorkflowEvidence } from './githubIntegration.js';
import { installAuthentication } from './auth.js';

const store = vi.hoisted(() => ({
  state: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  connection: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const apps: FastifyInstance[] = [];
const userId = '00000000-0000-4000-8000-000000000123';
const encryptionKey = Buffer.alloc(32, 0xa7);
const rawAccessToken = 'ghu.synthetic-access-token';
const rawRefreshToken = 'ghr.synthetic-refresh-token';

function mockResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeJobLogZip(): Buffer {
  const filename = Buffer.from('1_build.txt');
  const raw = Buffer.from('error TS2322: synthetic failure\\nAuthorization: Bearer secret-value');
  const compressed = raw;
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(filename.length, 26); filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(filename.length, 28);
  filename.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

function storedConnection(overrides: Record<string, unknown> = {}) {
  return {
    userId,
    githubUserId: '123456',
    githubLogin: 'synthetic-owner',
    repositoryId: '1361308785',
    repositoryFullName: GITHUB_APP_REPOSITORY,
    repositoryPermissions: { pull: true, push: false },
    encryptedAccessToken: encryptGitHubSecret(rawAccessToken, encryptionKey),
    encryptedRefreshToken: encryptGitHubSecret(rawRefreshToken, encryptionKey),
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    connectedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUser', null);
  app.decorate('prisma', {
    gitHubOAuthState: store.state,
    gitHubAppConnection: store.connection,
  } as unknown as PrismaClient);
  app.addHook('onRequest', async (request) => {
    if (request.headers.authorization === 'Bearer test-user') {
      request.authUser = { id: userId, email: 'owner@example.test', role: 'user', isOwner: false };
    }
  });
  installAuthentication(app);
  await app.register(githubIntegrationRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.8a61f9b3a7aba766');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'synthetic-client-secret');
  vi.stubEnv('GITHUB_APP_CALLBACK_URL', 'https://api.example.test/api/github/callback');
  vi.stubEnv('GITHUB_APP_RETURN_URL', 'https://app.example.test/');
  vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', 'a7'.repeat(32));
  store.state.create.mockImplementation(async ({ data }) => data);
  store.state.deleteMany.mockResolvedValue({ count: 1 });
  store.state.findUnique.mockResolvedValue(null);
  store.connection.findUnique.mockResolvedValue(null);
  store.connection.upsert.mockResolvedValue({});
  store.connection.updateMany.mockResolvedValue({ count: 1 });
  store.connection.deleteMany.mockResolvedValue({ count: 1 });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});


describe('owner-bound read-only repository inspection', () => {
  it('returns the pinned repository and exact default-branch commit for its connected owner', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        name: 'RYANAI-Automous-Reasioning-Plat-main',
        full_name: GITHUB_APP_REPOSITORY,
        html_url: 'https://github.com/' + GITHUB_APP_REPOSITORY,
        default_branch: 'main',
        permissions: { pull: true, push: false, admin: false },
      }))
      .mockResolvedValueOnce(mockResponse({
        sha: 'a'.repeat(40),
        html_url: 'https://github.com/' + GITHUB_APP_REPOSITORY + '/commit/' + 'a'.repeat(40),
      }));
    const snapshot = await inspectConnectedGitHubRepository(app, userId);
    expect(snapshot.repositoryFullName).toBe(GITHUB_APP_REPOSITORY);
    expect(snapshot.accountLogin).toBe('synthetic-owner');
    expect(snapshot.defaultBranch).toBe('main');
    expect(snapshot.commitSha).toBe('a'.repeat(40));
    expect(snapshot.source).toBe('github-oauth-read-only');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) =>
      String(url).startsWith('https://api.github.com/') &&
      (init as RequestInit | undefined)?.method === undefined,
    )).toBe(true);
  });

  it('rejects a missing owner connection without making a provider request', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(null);
    await expect(inspectConnectedGitHubRepository(app, userId)).rejects.toThrow('github_owner_connection_missing_or_wrong_repository');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a repository recreated under the same name with a different immutable ID', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 999999999,
        full_name: GITHUB_APP_REPOSITORY,
        default_branch: 'main',
        permissions: { pull: true },
      }));
    await expect(inspectConnectedGitHubRepository(app, userId)).rejects.toThrow('github_owner_or_repository_verification_failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('requires owner reauthorization instead of refreshing or rotating an expired token', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection({
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    }));
    await expect(inspectConnectedGitHubRepository(app, userId)).rejects.toThrow('github_owner_reauthorization_required');
    expect(fetch).not.toHaveBeenCalled();
    expect(store.connection.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a GitHub identity mismatch before reading repository state', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 999999, login: 'different-owner' }))
      .mockResolvedValueOnce(mockResponse({ full_name: GITHUB_APP_REPOSITORY, default_branch: 'main', permissions: { pull: true } }));
    await expect(inspectConnectedGitHubRepository(app, userId)).rejects.toThrow('github_owner_or_repository_verification_failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('GitHub App in-app authorization lifecycle', () => {
  it('requires a verified RyanAI session to start or inspect a connection', async () => {
    const app = await createApp();
    const connect = await app.inject({ method: 'POST', url: '/api/github/connect' });
    const status = await app.inject({ method: 'GET', url: '/api/github/status' });
    expect(connect.statusCode).toBe(401);
    expect(status.statusCode).toBe(401);
    expect(store.state.create).not.toHaveBeenCalled();
    expect(store.connection.findUnique).not.toHaveBeenCalled();
  });

  it('allows the public callback to reach one-time state validation without an application session', async () => {
    const app = await createApp();
    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=unknown-state',
    });
    expect(callback.statusCode).toBe(400);
    expect(callback.json().error).toContain('state is expired or invalid');
    expect(fetch).not.toHaveBeenCalled();
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('fails closed when the GitHub App is not registered or its encryption key is missing', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(503);
    expect(store.state.create).not.toHaveBeenCalled();
  });

  it('starts an authenticated PKCE flow and stores only hashed state plus encrypted verifier', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    const authorizationUrl = new URL(response.json().authorizationUrl);
    const created = store.state.create.mock.calls[0][0].data;
    expect(created.userId).toBe(userId);
    expect(created.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(authorizationUrl.searchParams.get('state')).not.toBe(created.stateHash);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('scope')).toBe('offline_access');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/github/callback');
    expect(created.encryptedCodeVerifier).toMatch(/^v1\./);
    expect(decryptGitHubSecret(created.encryptedCodeVerifier, encryptionKey)).toHaveLength(43);
  });

  it('rejects missing, expired or already-claimed OAuth state before exchanging a code', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/callback?code=synthetic-code&state=unknown-state',
    });
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('exchanges the code, verifies the GitHub identity and official repo, then persists encrypted tokens', async () => {
    const app = await createApp();
    let pending: Record<string, unknown> | null = null;
    store.state.create.mockImplementation(async ({ data }) => { pending = data; return data; });
    store.state.findUnique.mockImplementation(async () => pending);
    const authorization = await app.inject({
      method: 'POST', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    const state = new URL(authorization.json().authorizationUrl).searchParams.get('state')!;
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockResponse({
        access_token: rawAccessToken,
        refresh_token: rawRefreshToken,
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner', avatar_url: 'https://avatars.example.test/owner.png' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false, admin: false },
      }));

    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=' + encodeURIComponent(state),
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://app.example.test/?github=connected');
    expect(store.state.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { stateHash: pending?.stateHash, expiresAt: { gt: expect.any(Date) } },
    }));
    expect(store.connection.upsert).toHaveBeenCalledTimes(1);
    const persisted = store.connection.upsert.mock.calls[0][0].create;
    expect(persisted.userId).toBe(userId);
    expect(persisted.githubLogin).toBe('synthetic-owner');
    expect(persisted.repositoryFullName).toBe(GITHUB_APP_REPOSITORY);
    expect(persisted.encryptedAccessToken).toMatch(/^v1\./);
    expect(persisted.encryptedRefreshToken).toMatch(/^v1\./);
    expect(persisted.encryptedAccessToken).not.toContain(rawAccessToken);
    expect(persisted.encryptedRefreshToken).not.toContain(rawRefreshToken);
    expect(callback.body).not.toContain(rawAccessToken);
  });

  it('does not persist a token when the official repository permission is missing', async () => {
    const app = await createApp();
    let pending: Record<string, unknown> | null = null;
    store.state.create.mockImplementation(async ({ data }) => { pending = data; return data; });
    store.state.findUnique.mockImplementation(async () => pending);
    const authorization = await app.inject({
      method: 'POST', url: '/api/github/connect',
      headers: { authorization: 'Bearer test-user' },
    });
    const state = new URL(authorization.json().authorizationUrl).searchParams.get('state')!;
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({
        access_token: rawAccessToken,
        refresh_token: rawRefreshToken,
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: false, push: false },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const callback = await app.inject({
      method: 'GET',
      url: '/api/github/callback?code=synthetic-code&state=' + encodeURIComponent(state),
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://app.example.test/?github=error');
    expect(store.connection.upsert).not.toHaveBeenCalled();
  });

  it('reports a verified connection without returning either credential to the browser', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }));
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/status',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: GITHUB_APP_REPOSITORY, permissions: { pull: true, push: false } },
    });
    expect(response.body).not.toContain(rawAccessToken);
    expect(response.body).not.toContain(rawRefreshToken);
  });

  it('exposes a persisted connection for local disconnect when App configuration is unavailable', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.stubEnv('GITHUB_APP_CLIENT_ID', '');
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    vi.stubEnv('GITHUB_APP_CALLBACK_URL', '');
    vi.stubEnv('GITHUB_APP_RETURN_URL', '');
    vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', '');

    const app = await createApp();
    const status = await app.inject({
      method: 'GET', url: '/api/github/status',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: 'configuration_unavailable',
      connected: false,
      persistedConnection: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: GITHUB_APP_REPOSITORY },
    });

    const disconnect = await app.inject({
      method: 'POST', url: '/api/github/disconnect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(disconnect.statusCode).toBe(200);
    expect(disconnect.json()).toEqual({ disconnected: true, remoteRevocation: 'unconfirmed' });
    expect(store.connection.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  });

  it('rotates an expiring access and refresh token before reporting status', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection({
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({
        access_token: 'ghu.rotated-access-token',
        refresh_token: 'ghr.rotated-refresh-token',
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }))
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }));
    const app = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/api/github/status',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('connected');
    expect(store.connection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId, encryptedRefreshToken: expect.any(String) }),
      data: expect.objectContaining({ accessTokenExpiresAt: expect.any(Date), refreshTokenExpiresAt: expect.any(Date) }),
    }));
    expect(response.body).not.toContain('ghu.rotated-access-token');
  });

  it('returns read-only Copilot review provenance without review bodies or private source names', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785,
        full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }))
      .mockResolvedValueOnce(mockResponse({
        data: {
          repository: {
            pullRequest: {
              headRefOid: 'a'.repeat(40),
              reviews: {
                totalCount: 1,
                pageInfo: { hasNextPage: false },
                nodes: [{
                  id: 'PRR_copilot',
                  state: 'COMMENTED',
                  submittedAt: '2026-11-08T09:00:00.000Z',
                  commit: { oid: 'a'.repeat(40) },
                  author: { __typename: 'Bot', login: 'copilot-reviewer[bot]' },
                  isCopilotCodeReview: true,
                  copilotCodeReviewEffort: 'BALANCED',
                  comments: {
                    pageInfo: { hasNextPage: false },
                    nodes: [{
                      id: 'PRRC_1',
                      isCopilotCodeReview: true,
                      copilotCodeReviewSources: [{ kind: 'MCP', name: 'private-catalog', path: '.github/mcp.json' }],
                      body: 'Sensitive review text must not be returned',
                    }],
                  },
                  body: 'Sensitive review text must not be returned',
                }],
              },
            },
          },
        },
      }));
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/github/pull-requests/1330/review-provenance',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'available',
      pullRequestNumber: 1330,
      headSha: 'a'.repeat(40),
      copilotReviewCount: 1,
      exactHeadHumanApprovalCount: 0,
      reviews: [{
        actorKind: 'copilot',
        effortLevel: 'balanced',
        commentAttributions: [{ commentId: 'PRRC_1', sourceKinds: ['mcp'] }],
      }],
    });
    expect(response.body).not.toContain('Sensitive review text');
    expect(response.body).not.toContain('private-catalog');
    expect(response.body).not.toContain('.github/mcp.json');
    const [target, options] = vi.mocked(fetch).mock.calls[2];
    expect(String(target)).toBe('https://api.github.com/graphql');
    expect(options?.method).toBe('POST');
    expect(String(options?.body)).not.toContain('body {');
  });

  it('requires a valid PR number and authenticated repository connection for provenance', async () => {
    const app = await createApp();
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/github/pull-requests/not-a-number/review-provenance',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/github/pull-requests/1330/review-provenance',
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('revokes the remote token and removes local credentials on disconnect', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/disconnect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ disconnected: true, remoteRevocation: 'confirmed' });
    expect(store.connection.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    const [target, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(target)).toBe('https://api.github.com/applications/Iv1.8a61f9b3a7aba766/grant');
    expect(options?.method).toBe('DELETE');
    expect(JSON.parse(String(options?.body))).toEqual({ access_token: rawAccessToken });
  });

  it('removes local credentials even when remote revocation is unavailable', async () => {
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network failure'));
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: '/api/github/disconnect',
      headers: { authorization: 'Bearer test-user' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ disconnected: true, remoteRevocation: 'unconfirmed' });
    expect(store.connection.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  });
});


describe('owner-bound exact-head GitHub workflow evidence', () => {
  it('returns only workflow and job metadata for the verified requested commit', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'b'.repeat(40);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785, full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true, push: false },
      }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({
        total_count: 1,
        workflow_runs: [{
          id: 991, name: 'CI', head_sha: headSha, status: 'completed',
          conclusion: 'success', html_url: 'https://github.com/example/run/991',
        }],
      }))
      .mockResolvedValueOnce(mockResponse({
        total_count: 1,
        jobs: [{ name: 'typecheck', status: 'completed', conclusion: 'success' }],
      }));

    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha);
    expect(evidence.verifiedHeadSha).toBe(headSha);
    expect(evidence.workflowRuns).toHaveLength(1);
    expect(evidence.workflowRuns[0].jobs[0]).toEqual({
      name: 'typecheck', status: 'completed', conclusion: 'success',
      id: 0, name: 'typecheck', status: 'completed', conclusion: 'success',
    });
    expect(JSON.stringify(evidence)).not.toContain(rawAccessToken);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) =>
      String(url).startsWith('https://api.github.com/') &&
      (init as RequestInit | undefined)?.method === undefined,
    )).toBe(true);
  });

  it('rejects a non-full commit SHA before any GitHub request', async () => {
    const app = await createApp();
    await expect(inspectConnectedGitHubWorkflowEvidence(app, userId, 'main'))
      .rejects.toThrow('github_workflow_head_sha_invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a response whose commit SHA does not match the requested SHA', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785, full_name: GITHUB_APP_REPOSITORY,
        permissions: { pull: true },
      }))
      .mockResolvedValueOnce(mockResponse({ sha: 'c'.repeat(40) }));
    await expect(inspectConnectedGitHubWorkflowEvidence(app, userId, 'b'.repeat(40)))
      .rejects.toThrow('github_workflow_commit_sha_mismatch');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});


describe('bounded GitHub workflow evidence pagination', () => {
  it('fetches a second page when GitHub reports more than 50 workflow runs', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'd'.repeat(40);
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1, name: 'other workflow', head_sha: 'e'.repeat(40),
      status: 'completed', conclusion: 'success',
    }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({
        id: 1361308785, full_name: GITHUB_APP_REPOSITORY, permissions: { pull: true },
      }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({ total_count: 51, workflow_runs: firstPage }))
      .mockResolvedValueOnce(mockResponse({
        total_count: 51,
        workflow_runs: [{
          id: 991, name: 'exact-head workflow', head_sha: headSha,
          status: 'completed', conclusion: 'success',
        }],
      }))
      .mockResolvedValueOnce(mockResponse({
        total_count: 1, jobs: [{ name: 'typecheck', status: 'completed', conclusion: 'success' }],
      }));

    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha);
    expect(evidence.workflowRuns).toHaveLength(1);
    expect(evidence.workflowRuns[0].headSha).toBe(headSha);
    expect(evidence.complete).toBe(true);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/actions/runs?') && url.includes('page=2'))).toBe(true);
  });
});


describe('capability-gated GitHub Actions job log retrieval', () => {

  it('enforces the archive byte limit while streaming when Content-Length is absent', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'e'.repeat(40);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({ id: 1361308785, full_name: GITHUB_APP_REPOSITORY, permissions: { pull: true } }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, workflow_runs: [{
        id: 94, name: 'build', head_sha: headSha, status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, jobs: [{
        id: 504, name: 'build', status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://productionresultssa1.blob.core.windows.net/logs/signed.zip?sig=synthetic' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status: 200 }));
    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha, { includeJobLogs: true });
    expect(evidence.jobLogStatus).toBe('partial');
    expect(evidence.jobLogExcerpts).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('does not request job logs unless explicitly enabled', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'b'.repeat(40);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({ id: 1361308785, full_name: GITHUB_APP_REPOSITORY, permissions: { pull: true } }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, workflow_runs: [{
        id: 91, name: 'build', head_sha: headSha, status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, jobs: [{
        id: 501, name: 'build', status: 'completed', conclusion: 'failure',
      }] }));
    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha);
    expect(evidence.jobLogStatus).toBe('not_requested');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('rejects an untrusted redirect host without forwarding authorization', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'c'.repeat(40);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({ id: 1361308785, full_name: GITHUB_APP_REPOSITORY, permissions: { pull: true } }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, workflow_runs: [{
        id: 92, name: 'build', head_sha: headSha, status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, jobs: [{
        id: 502, name: 'build', status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://attacker.example/logs.zip' },
      }));
    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha, { includeJobLogs: true });
    expect(evidence.jobLogStatus).toBe('partial');
    expect(evidence.jobLogExcerpts).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect((vi.mocked(fetch).mock.calls[5][1] as RequestInit).redirect).toBe('manual');
  });

  it('downloads only from the approved GitHub log host and returns sanitized signature evidence', async () => {
    const app = await createApp();
    store.connection.findUnique.mockResolvedValue(storedConnection());
    const headSha = 'd'.repeat(40);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse({ id: 123456, login: 'synthetic-owner' }))
      .mockResolvedValueOnce(mockResponse({ id: 1361308785, full_name: GITHUB_APP_REPOSITORY, permissions: { pull: true } }))
      .mockResolvedValueOnce(mockResponse({ sha: headSha }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, workflow_runs: [{
        id: 93, name: 'build', head_sha: headSha, status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(mockResponse({ total_count: 1, jobs: [{
        id: 503, name: 'build', status: 'completed', conclusion: 'failure',
      }] }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://productionresultssa1.blob.core.windows.net/logs/signed.zip?sig=synthetic' },
      }))
      .mockResolvedValueOnce(new Response(makeJobLogZip(), { status: 200 }));
    const evidence = await inspectConnectedGitHubWorkflowEvidence(app, userId, headSha, { includeJobLogs: true });
    expect(evidence.jobLogStatus).toBe('complete');
    expect(evidence.jobLogExcerpts).toHaveLength(1);
    expect(evidence.jobLogExcerpts[0].excerpt).toContain('error TS2322');
    expect(evidence.jobLogExcerpts[0].excerpt).not.toContain('secret-value');
    expect((vi.mocked(fetch).mock.calls[6][1] as RequestInit).headers).toBeUndefined();
  });
});
