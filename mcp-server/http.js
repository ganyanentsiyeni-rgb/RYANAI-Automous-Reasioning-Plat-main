import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './index.js';
import { verifyMcpDelegationToken } from './delegation.js';

const production = process.env.NODE_ENV === 'production';
const host = process.env.MCP_HOST || (production ? '0.0.0.0' : '127.0.0.1');
// MCP is a separate service: never inherit the API's generic PORT.
const port = Number(process.env.MCP_PORT || 8765);
const delegationSecret = process.env.RYANAI_MCP_DELEGATION_SECRET || '';
const serviceToken = process.env.RYANAI_MCP_SERVICE_TOKEN || '';
const apiBaseUrl = process.env.RYANAI_API_BASE_URL || (production ? '' : 'http://127.0.0.1:3000');
const allowedHosts = new Set(
  (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const allowedOrigins = new Set(
  (process.env.MCP_ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { throw new Error('MCP_ALLOWED_ORIGINS must contain valid absolute origins.'); }
    }),
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MCP_PORT must be an integer between 1 and 65535.');
}

if (!apiBaseUrl) throw new Error('RYANAI_API_BASE_URL is required for the production MCP HTTP transport.');
if (delegationSecret.length < 32 || serviceToken.length < 32) {
  throw new Error('RYANAI_MCP_DELEGATION_SECRET and RYANAI_MCP_SERVICE_TOKEN must each contain at least 32 characters.');
}
if (!['127.0.0.1', '::1', 'localhost'].includes(host)
  && [...allowedHosts].every((name) => ['localhost', '127.0.0.1', '[::1]'].includes(name))) {
  throw new Error('MCP_ALLOWED_HOSTS must explicitly include the deployed MCP hostname.');
}

const httpServer = createHttpServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://localhost');

  if (requestUrl.pathname === '/health' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', service: 'ryanai-mcp-manager', transport: 'streamable-http' }));
    return;
  }

  if (requestUrl.pathname !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let hostHeader;
  try {
    hostHeader = new URL(`http://${request.headers.host || ''}`).hostname.toLowerCase();
  } catch {
    hostHeader = '';
  }
  if (!allowedHosts.has(hostHeader)) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Host is not allowed' }));
    return;
  }

  const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1];
  if (!bearer) {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' });
    response.end(JSON.stringify({ error: 'A short-lived API-issued delegated identity is required.' }));
    return;
  }
  try {
    verifyMcpDelegationToken(bearer, delegationSecret);
  } catch {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer' });
    response.end(JSON.stringify({ error: 'Delegated identity is invalid or expired.' }));
    return;
  }

  const origin = request.headers.origin;
  if (typeof origin === 'string' && !allowedOrigins.has(origin)) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Origin is not allowed' }));
    return;
  }

  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Only POST is supported by the stateless MCP endpoint' }));
    return;
  }

  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > 1024 * 1024) {
    response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Request body is too large' }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer({ delegatedToken: bearer, requireDelegation: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error('MCP HTTP request failed:', error instanceof Error ? error.message : String(error));
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'MCP request failed' }));
    }
  } finally {
    await server.close().catch((error) => {
      console.error('Could not close MCP request server:', error instanceof Error ? error.message : String(error));
    });
  }
});

httpServer.requestTimeout = 120_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;

httpServer.listen(port, host, () => {
  console.error(`RyanAI MCP Manager listening at http://${host}:${port}/mcp`);
});

async function shutdown(signal) {
  console.error(`Received ${signal}; closing RyanAI MCP Manager.`);
  httpServer.close((error) => {
    if (error) {
      console.error('MCP HTTP server shutdown failed:', error.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

