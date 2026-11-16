import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueMcpDelegationToken } from '../security/mcpDelegation.js';
import { providerGatewayRoutes } from './providerGateway.js';

const serviceToken = 'provider-gateway-service-token-with-at-least-32-bytes';
const signingSecret = 'provider-gateway-signing-secret-with-at-least-32-bytes';

function delegatedToken() {
  return issueMcpDelegationToken({
    subject: 'verified-user',
    role: 'user',
    scopes: ['reasoning_request'],
    secret: signingSecret,
  }).token;
}

describe('governed provider gateway', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function makeApp() {
    const app = Fastify();
    await app.register(providerGatewayRoutes);
    await app.ready();
    return app;
  }

  function headers(token = delegatedToken()) {
    return {
      authorization: 'Bearer ' + token,
      'x-ryanai-service-token': serviceToken,
    };
  }

  it('requires MCP service authentication and a valid delegated identity', async () => {
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    const app = await makeApp();
    const noService = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: { authorization: 'Bearer ' + delegatedToken() },
      payload: { providerId: 'openai', model: 'gpt-4o-mini', prompt: 'hello' },
    });
    expect(noService.statusCode).toBe(401);
    const noDelegation = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: { 'x-ryanai-service-token': serviceToken },
      payload: { providerId: 'openai', model: 'gpt-4o-mini', prompt: 'hello' },
    });
    expect(noDelegation.statusCode).toBe(401);
    await app.close();
  });

  it('dispatches OpenAI-compatible calls only after Gen-X and model allowlist checks', async () => {
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    vi.stubEnv('OPENAI_API_KEY', 'openai-provider-secret');
    vi.stubEnv('OPENAI_MODEL_ALLOWLIST', 'gpt-4o-mini');
    let outbound;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      outbound = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'API gateway response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 9 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(),
      payload: { providerId: 'openai', model: 'gpt-4o-mini', prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true, providerId: 'openai', model: 'gpt-4o-mini',
      response: 'API gateway response',
      usage: { inputTokens: 5, outputTokens: 9 },
      policyDecision: 'ALLOW',
    });
    expect(outbound.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(outbound.headers.authorization).toBe('Bearer openai-provider-secret');
    expect(outbound.body.model).toBe('gpt-4o-mini');
    expect(response.body).not.toContain('openai-provider-secret');
    await app.close();
  });

  it('uses the native Anthropic Messages contract and x-api-key header', async () => {
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-provider-secret');
    vi.stubEnv('ANTHROPIC_MODEL_ALLOWLIST', 'claude-test-model');
    let outbound;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      outbound = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Claude response' }],
        usage: { input_tokens: 4, output_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(),
      payload: { providerId: 'anthropic', model: 'claude-test-model', prompt: 'hello' },
    });
    expect(response.statusCode).toBe(200);
    expect(outbound.url).toBe('https://api.anthropic.com/v1/messages');
    expect(outbound.headers['x-api-key']).toBe('anthropic-provider-secret');
    expect(outbound.headers['anthropic-version']).toBe('2023-06-01');
    expect(outbound.body.model).toBe('claude-test-model');
    expect(response.json().response).toBe('Claude response');
    expect(response.body).not.toContain('anthropic-provider-secret');
    await app.close();
  });

  it('rejects missing credentials, unapproved models and unsupported JSON capability', async () => {
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-provider-secret');
    vi.stubEnv('ANTHROPIC_MODEL_ALLOWLIST', 'claude-test-model');
    const app = await makeApp();
    const missing = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(),
      payload: { providerId: 'deepseek', model: 'DeepSeek-V4.1-Flash-1017', prompt: 'hello' },
    });
    expect(missing.statusCode).toBe(503);
    const unapproved = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(),
      payload: { providerId: 'anthropic', model: 'claude-unlisted', prompt: 'hello' },
    });
    expect(unapproved.statusCode).toBe(400);
    const unsupported = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(),
      payload: { providerId: 'anthropic', model: 'claude-test-model', prompt: 'hello', responseFormat: 'json_object' },
    });
    expect(unsupported.statusCode).toBe(400);
    await app.close();
  });

  it('rejects provider calls when the delegated token has no reasoning scope', async () => {
    vi.stubEnv('RYANAI_MCP_SERVICE_TOKEN', serviceToken);
    vi.stubEnv('RYANAI_MCP_DELEGATION_SECRET', signingSecret);
    const token = issueMcpDelegationToken({
      subject: 'verified-user', role: 'user', scopes: ['platform_health'], secret: signingSecret,
    }).token;
    const app = await makeApp();
    const response = await app.inject({
      method: 'POST', url: '/api/internal/mcp/reasoning',
      headers: headers(token),
      payload: { providerId: 'openai', model: 'gpt-4o-mini', prompt: 'hello' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
