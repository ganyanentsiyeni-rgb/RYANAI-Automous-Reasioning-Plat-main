import { createHmac, timingSafeEqual } from 'node:crypto';

export const MCP_TOOL_SCOPES = Object.freeze({
  tool_registry: 'tool_registry',
  repository_status: 'repository_status',
  platform_health: 'platform_health',
  ryanai_stack_manifest: 'ryanai_stack_manifest',
  reasoning_route: 'reasoning_request',
});

const MAX_TTL_SECONDS = 120;

export function verifyMcpDelegationToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('MCP delegation verification is not configured.');
  if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid delegated identity token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid delegated identity token.');

  const signingInput = parts[0] + '.' + parts[1];
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const supplied = Buffer.from(parts[2], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('Invalid delegated identity signature.');
  }

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid delegated identity token payload.');
  }

  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT'
    || !claims || typeof claims !== 'object'
    || claims.iss !== 'ryanai-api' || claims.aud !== 'ryanai-mcp'
    || typeof claims.sub !== 'string' || !claims.sub
    || !['user', 'admin'].includes(claims.role)
    || !['human', 'agent', 'service'].includes(claims.actorType)
    || !Array.isArray(claims.scope) || claims.scope.length < 1
    || claims.scope.some((scope) => !Object.values(MCP_TOOL_SCOPES).includes(scope))
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || typeof claims.jti !== 'string' || !claims.jti
    || claims.exp <= nowSeconds || claims.iat > nowSeconds + 5
    || claims.exp - claims.iat > MAX_TTL_SECONDS) {
    throw new Error('Delegated identity claims are invalid or expired.');
  }
  return claims;
}

export async function authorizeDelegatedTool({
  token,
  toolName,
  secret,
  serviceToken,
  apiBaseUrl,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const claims = verifyMcpDelegationToken(token, secret, nowSeconds);
  const scope = MCP_TOOL_SCOPES[toolName];
  if (!scope || !claims.scope.includes(scope)) {
    throw new Error('Delegated identity does not grant this MCP tool.');
  }
  if (typeof serviceToken !== 'string' || serviceToken.length < 32) {
    throw new Error('MCP service authentication is not configured.');
  }
  let base;
  try {
    base = new URL(apiBaseUrl);
  } catch {
    throw new Error('RyanAI API base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('RyanAI API base URL must be a clean HTTP or HTTPS origin.');
  }
  // Docker Compose's fixed internal API service alias is a trusted private-network target.
  // Public/remote API hosts must still use HTTPS.
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', 'api'].includes(base.hostname.toLowerCase())) {
    throw new Error('Remote RyanAI API endpoints must use HTTPS.');
  }
  const response = await fetchImpl(new URL('/api/internal/mcp/authorize', base), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'x-ryanai-service-token': serviceToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scope }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('RyanAI API denied MCP tool authorization.');
  const result = await response.json();
  if (result?.allowed !== true || result?.scope !== scope || result?.principalId !== claims.sub) {
    throw new Error('RyanAI API did not confirm the delegated MCP capability.');
  }
  return { claims, scope };
}
