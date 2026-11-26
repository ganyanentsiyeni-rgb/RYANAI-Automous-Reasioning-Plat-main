import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authorizeDelegatedTool, verifyMcpDelegationToken } from './delegation.js';

const secret = 'test-only-mcp-delegation-secret-32-bytes';
const serviceToken = 'test-only-service-token-32-bytes-long';

function tokenFor(overrides = {}, now = 1_800_000_000) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = {
    iss: 'ryanai-api', aud: 'ryanai-mcp', sub: 'user-123', role: 'user', actorType: 'human',
    scope: ['platform_health'], iat: now, exp: now + 60, jti: 'jti-test',
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = header + '.' + payload;
  return input + '.' + createHmac('sha256', secret).update(input).digest('base64url');
}

test('verifies API-issued HMAC delegated identity and narrow scopes', () => {
  const claims = verifyMcpDelegationToken(tokenFor(), secret, 1_800_000_010);
  assert.equal(claims.sub, 'user-123');
  assert.deepEqual(claims.scope, ['platform_health']);
});

test('rejects expired, wrong-audience, overlong and unknown-scope tokens', () => {
  assert.throws(() => verifyMcpDelegationToken(tokenFor({ exp: 1_800_000_000 }), secret, 1_800_000_000), /expired/);
  assert.throws(() => verifyMcpDelegationToken(tokenFor({ aud: 'other' }), secret, 1_800_000_010), /invalid or expired/);
  assert.throws(() => verifyMcpDelegationToken(tokenFor({ actorType: 'root' }), secret, 1_800_000_010), /invalid or expired/);
  assert.throws(() => verifyMcpDelegationToken(tokenFor({ exp: 1_800_000_200 }), secret, 1_800_000_010), /invalid or expired/);
  assert.throws(() => verifyMcpDelegationToken(tokenFor({ scope: ['run_project_checks'] }), secret, 1_800_000_010), /invalid or expired/);
});

test('rejects a tampered signature and missing signing secret', () => {
  const token = tokenFor();
  assert.throws(() => verifyMcpDelegationToken(token.slice(0, -1) + 'x', secret, 1_800_000_010), /signature/);
  assert.throws(() => verifyMcpDelegationToken(token, '', 1_800_000_010), /not configured/);
});

test('requires tool scope and API-side execution-time authorization', async () => {
  const token = tokenFor();
  let called = false;
  const result = await authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'platform_health', secret, serviceToken,
    apiBaseUrl: 'https://ryanai-api.example.test',
    fetchImpl: async (url, init) => {
      called = true;
      assert.equal(String(url), 'https://ryanai-api.example.test/api/internal/mcp/authorize');
      assert.equal(init.headers['x-ryanai-service-token'], serviceToken);
      assert.deepEqual(JSON.parse(init.body), { scope: 'platform_health' });
      return { ok: true, json: async () => ({ allowed: true, scope: 'platform_health', principalId: 'user-123' }) };
    },
  });
  assert.equal(called, true);
  assert.equal(result.claims.sub, 'user-123');
  await assert.rejects(() => authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'repository_status', secret, serviceToken,
    apiBaseUrl: 'https://ryanai-api.example.test',
    fetchImpl: async () => { throw new Error('must not call API without scope'); },
  }), /does not grant/);
});

test('fails closed when API reauthorization is denied or unavailable', async () => {
  const token = tokenFor();
  await assert.rejects(() => authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'platform_health', secret, serviceToken,
    apiBaseUrl: 'https://ryanai-api.example.test',
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  }), /API denied/);
  await assert.rejects(() => authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'platform_health', secret, serviceToken,
    apiBaseUrl: 'http://remote.example.test',
  }), /must use HTTPS/);
});

test('reasoning_route requires the delegated reasoning_request scope and API reauthorization', async () => {
  const token = tokenFor({ scope: ['reasoning_request'] });
  let body;
  const result = await authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'reasoning_route', secret, serviceToken,
    apiBaseUrl: 'https://ryanai-api.example.test',
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://ryanai-api.example.test/api/internal/mcp/authorize');
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ allowed: true, scope: 'reasoning_request', principalId: 'user-123' }) };
    },
  });
  assert.deepEqual(body, { scope: 'reasoning_request' });
  assert.equal(result.scope, 'reasoning_request');
});

test('allows the fixed Docker Compose API service alias over the private network', async () => {
  const token = tokenFor({ scope: ['reasoning_request'] });
  let called = false;
  const result = await authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'reasoning_route', secret, serviceToken,
    apiBaseUrl: 'http://api:3000',
    fetchImpl: async (url, init) => {
      called = true;
      assert.equal(String(url), 'http://api:3000/api/internal/mcp/authorize');
      assert.equal(init.headers.authorization, 'Bearer ' + token);
      assert.equal(init.headers['x-ryanai-service-token'], serviceToken);
      return { ok: true, json: async () => ({ allowed: true, scope: 'reasoning_request', principalId: 'user-123' }) };
    },
  });
  assert.equal(called, true);
  assert.equal(result.scope, 'reasoning_request');
});

test('does not allow arbitrary HTTP service aliases', async () => {
  const token = tokenFor({ scope: ['reasoning_request'] });
  await assert.rejects(() => authorizeDelegatedTool({
    token, nowSeconds: 1_800_000_010, toolName: 'reasoning_route', secret, serviceToken,
    apiBaseUrl: 'http://other-service:3000',
    fetchImpl: async () => { throw new Error('fetch must not be called'); },
  }), /must use HTTPS/);
});
