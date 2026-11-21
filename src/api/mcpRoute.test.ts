import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMcpRoutes } from './mcpRoute.js';

describe('MCP status endpoint', () => {
  let app: ReturnType<typeof Fastify> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('does not claim a live connection when the endpoint has not probed an MCP runtime', async () => {
    app = Fastify();
    await registerMcpRoutes(app);
    const response = await app.inject({ method: 'GET', url: '/api/mcp' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'unverified',
      connection: 'not_checked',
      protocol: 'Model Context Protocol',
    });
    expect(response.json().status).not.toBe('active');
  });
});
