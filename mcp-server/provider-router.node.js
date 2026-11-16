import test from 'node:test';
import assert from 'node:assert/strict';
import { routeReasoning, SUPPORTED_REASONING_PROVIDERS } from './provider-router.js';

const env = {
  RYANAI_API_BASE_URL: 'http://api:3000',
  RYANAI_MCP_SERVICE_TOKEN: 'service-token-for-tests-with-at-least-32-bytes',
};
const delegatedToken = 'api-issued-short-lived-delegation-token';
const fetchOk = async () => new Response(JSON.stringify({
  success: true, providerId: 'deepseek', model: 'deepseek-test-model',
  response: 'central response', usage: { inputTokens: 4, outputTokens: 7 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('MCP exposes provider identities, not provider endpoints or credentials', () => {
  assert.deepEqual(SUPPORTED_REASONING_PROVIDERS, [
    'openai', 'deepseek', 'anthropic', 'openrouter', 'nvidia', 'qwen', 'xai', 'ollama',
  ]);
});

test('MCP fails closed without delegated identity or service authentication', async () => {
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env: {}, fetch: async () => { throw new Error('fetch must not be called'); },
  }), /delegated identity is required/);
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env: {}, delegatedToken, fetch: async () => { throw new Error('fetch must not be called'); },
  }), /service authentication is not configured/);
});

test('all providers route through the API with delegated identity and no provider credential', async () => {
  let request;
  const result = await routeReasoning('Hello from MCP', 'deepseek', 'deepseek-test-model', {
    env,
    delegatedToken,
    responseFormat: 'json_object',
    fetch: async (url, init) => {
      request = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        success: true, providerId: 'deepseek', model: 'deepseek-test-model',
        response: '{"ok":true}', usage: { inputTokens: 2, outputTokens: 3 },
      }), { status: 200 });
    },
  });
  assert.equal(request.url, 'http://api:3000/api/internal/mcp/reasoning');
  assert.equal(request.headers.authorization, 'Bearer ' + delegatedToken);
  assert.equal(request.headers['x-ryanai-service-token'], env.RYANAI_MCP_SERVICE_TOKEN);
  assert.deepEqual(request.body, {
    providerId: 'deepseek', model: 'deepseek-test-model',
    prompt: 'Hello from MCP', responseFormat: 'json_object',
  });
  assert.equal(result.mode, 'gateway');
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.response, '{"ok":true}');
  assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3 });
});

test('requires explicit provider and model selection and validates prompt bounds', async () => {
  const neverFetch = async () => { throw new Error('fetch must not be called'); };
  await assert.rejects(routeReasoning('hello', 'unknown', 'model', { env, delegatedToken, fetch: neverFetch }), /Unsupported provider/);
  await assert.rejects(routeReasoning('hello', 'openai', '', { env, delegatedToken, fetch: neverFetch }), /explicit allowlisted provider model/);
  await assert.rejects(routeReasoning(' ', 'openai', 'gpt-4o', { env, delegatedToken, fetch: neverFetch }), /Prompt must contain/);
});

test('remote API endpoint must use HTTPS', async () => {
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env: { ...env, RYANAI_API_BASE_URL: 'http://remote.example.test' },
    delegatedToken,
    fetch: async () => { throw new Error('fetch must not be called'); },
  }), /must use HTTPS/);
});

test('provider authorization and availability failures are safe and typed', async () => {
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env, delegatedToken, fetch: async () => new Response('{}', { status: 403 }),
  }), /Gen-X denied/);
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env, delegatedToken, fetch: async () => new Response('{}', { status: 503 }),
  }), /unavailable or rate limited/);
});

test('rejects a response whose provider/model does not match the request', async () => {
  await assert.rejects(routeReasoning('hello', 'openai', 'gpt-4o', {
    env, delegatedToken,
    fetch: async () => new Response(JSON.stringify({
      success: true, providerId: 'deepseek', model: 'other', response: 'unexpected',
    }), { status: 200 }),
  }), /invalid response/);
});
