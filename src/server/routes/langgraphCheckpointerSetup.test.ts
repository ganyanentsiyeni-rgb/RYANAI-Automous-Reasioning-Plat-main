// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { langGraphCheckpointerSetupRoutes } from './langgraphCheckpointerSetup.js';
import { checkpointer, postgresPool } from '../../db/langgraph-checkpointer.js';
import { inspectDatabaseSchema } from '../databaseSchema.js';

vi.mock('./auth.js', () => ({
  requireOwner: async (
    request: { headers: Record<string, unknown> },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (request.headers['x-test-owner'] !== 'true') {
      return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    }
  },
}));

vi.mock('../../db/langgraph-checkpointer.js', () => ({
  checkpointer: { setup: vi.fn() },
  postgresPool: { query: vi.fn() },
}));

vi.mock('../databaseSchema.js', () => ({
  inspectDatabaseSchema: vi.fn(),
}));

describe('owner-triggered LangGraph checkpointer setup', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp() {
    const app = Fastify();
    apps.push(app);
    await app.register(langGraphCheckpointerSetupRoutes);
    return app;
  }

  it('rejects non-owner requests without touching PostgreSQL setup', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/operations/langgraph-checkpointer/setup',
    });

    expect(response.statusCode).toBe(403);
    expect(checkpointer.setup).not.toHaveBeenCalled();
    expect(postgresPool.query).not.toHaveBeenCalled();
  });

  it('does not rerun setup when the migration ledger is already initialized', async () => {
    vi.mocked(inspectDatabaseSchema).mockResolvedValue({
      communications: true,
      agentCheckpointer: true,
    });
    vi.mocked(postgresPool.query).mockResolvedValue({
      rows: [{ version: 5 }],
    } as never);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/operations/langgraph-checkpointer/setup',
      headers: { 'x-test-owner': 'true' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'already_initialized',
      agentCheckpointer: true,
      migrationVersion: 5,
    });
    expect(checkpointer.setup).not.toHaveBeenCalled();
  });

  it('runs the supported setup method and verifies migration version 5+', async () => {
    vi.mocked(inspectDatabaseSchema)
      .mockResolvedValueOnce({ communications: true, agentCheckpointer: false })
      .mockResolvedValueOnce({ communications: true, agentCheckpointer: true });
    vi.mocked(checkpointer.setup).mockResolvedValue(undefined);
    vi.mocked(postgresPool.query).mockResolvedValue({
      rows: [{ version: 5 }],
    } as never);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/operations/langgraph-checkpointer/setup',
      headers: { 'x-test-owner': 'true' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'initialized',
      agentCheckpointer: true,
      migrationVersion: 5,
    });
    expect(checkpointer.setup).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when setup does not produce the expected schema version', async () => {
    vi.mocked(inspectDatabaseSchema)
      .mockResolvedValueOnce({ communications: true, agentCheckpointer: false })
      .mockResolvedValueOnce({ communications: true, agentCheckpointer: false });
    vi.mocked(checkpointer.setup).mockResolvedValue(undefined);
    vi.mocked(postgresPool.query).mockResolvedValue({
      rows: [{ version: 4 }],
    } as never);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/operations/langgraph-checkpointer/setup',
      headers: { 'x-test-owner': 'true' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'verification_failed',
      agentCheckpointer: false,
      migrationVersion: 4,
    });
  });
});
