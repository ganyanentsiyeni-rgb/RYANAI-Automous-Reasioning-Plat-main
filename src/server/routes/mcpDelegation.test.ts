import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { getUser, createContextClient } = vi.hoisted(() => ({ getUser: vi.fn(), createContextClient: vi.fn() }));
vi.mock('@supabase/server/core', () => ({ createContextClient }));

import { mcpDelegationRoutes } from './mcpDelegation.js';
import { installAuthentication } from './auth.js';
import { verifyMcpDelegationToken } from '../security/mcpDelegation.js';

const serviceToken = 'mcp-service-test-token-with-at-least-32-bytes';
const signingSecret = 'mcp-signing-test-secret-with-at-least-32-bytes';

describe('API MCP delegation endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    vi.stubEnv('NODE_ENV', 'test');
    createContextClient.mockReturnValue({ auth: { getUser, getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: 'verified-user-id', aal: 'aal2' } }, error: null }) } });
    getUser.mockResolvedValue({
      data: { user: { id: 'verified-user-id', email: 'member@example.test', app_metadata: { actor_type: 'human' }, user_metadata: {}, is_anonymous: false } },
      error: null,
    });
    app = Fastify();
    installAuthentication(app);
    await app.register(mcpDelegationRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('requires MCP service authentication and a verified Supabase user', async () => {
    const noService = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry'] },
    });
    expect(noService.statusCode).toBe(401);
    expect(getUser).not.toHaveBeenCalled();

    const noUser = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken },
      payload: { scopes: ['tool_registry'] },
    });
    expect(noUser.statusCode).toBe(401);
  });

  it('issues a verified, Gen-X-allowed, narrow-scope token', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry', 'platform_health'] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const claims = verifyMcpDelegationToken(body.token, signingSecret);
    expect(claims.sub).toBe('verified-user-id');
    expect(claims.actorType).toBe('human');
    expect(claims.scope).toEqual(['tool_registry', 'platform_health']);
    expect(body.audience).toBe('ryanai-mcp');
    expect(body.tokenType).toBe('Bearer');
  });

  it('issues a reasoning delegation only for a verified user and allowed Gen-X decision', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['reasoning_request'] },
    });
    expect(response.statusCode).toBe(200);
    expect(verifyMcpDelegationToken(response.json().token, signingSecret).scope).toEqual(['reasoning_request']);
  });


  it('does not promote a verified agent actor to human for reasoning delegation', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'verified-agent-id', email: 'agent@example.test', app_metadata: { actor_type: 'agent' }, user_metadata: {}, is_anonymous: false } },
      error: null,
    });
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['reasoning_request'] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects unapproved scopes before issuing a token', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['shell'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reauthorizes a delegated tool with Gen-X on every execution request', async () => {
    const issued = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['platform_health'] },
    });
    expect(issued.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/authorize',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer ' + issued.json().token },
      payload: { scope: 'platform_health' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      allowed: true, scope: 'platform_health', principalId: 'verified-user-id', decision: 'ALLOW',
    });
  });

  it('rejects an execution scope outside the delegated token', async () => {
    const issued = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['platform_health'] },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/authorize',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer ' + issued.json().token },
      payload: { scope: 'repository_status' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects missing or invalid delegated identity on execution', async () => {
    const missing = await app.inject({
      method: 'POST', url: '/api/internal/mcp/authorize',
      headers: { 'x-ryanai-service-token': serviceToken },
      payload: { scope: 'platform_health' },
    });
    expect(missing.statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST', url: '/api/internal/mcp/authorize',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer invalid.token.value' },
      payload: { scope: 'platform_health' },
    });
    expect(invalid.statusCode).toBe(401);
  });

  it('fails closed when the signing secret is absent', async () => {
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', '');
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/delegation',
      headers: { 'x-ryanai-service-token': serviceToken, authorization: 'Bearer supabase-access-token' },
      payload: { scopes: ['tool_registry'] },
    });
    expect(response.statusCode).toBe(503);
  });
});
