import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const patcher = vi.hoisted(() => ({ proposePullRequest: vi.fn() }));
vi.mock('../../engine/selfPatchSkill.js', () => ({ SelfPatchSkill: patcher }));
vi.mock('./auth.js', () => ({
  requireOwner: async (
    request: { authUser: { role: string; isOwner?: boolean } | null },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: 'Sign in to continue.' });
    }
    if (!request.authUser.isOwner) {
      return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    }
  },
}));

import { registerPatchRoutes } from './patchRoutes.js';

const admin = { 'x-test-user': 'owner-1', 'x-test-role': 'admin', 'x-test-owner': 'true' };
const member = { 'x-test-user': 'user-1', 'x-test-role': 'user', 'x-test-owner': 'false' };
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    (request as unknown as { authUser: unknown }).authUser = id
      ? { id: String(id), role: String(request.headers['x-test-role']), isOwner: request.headers['x-test-owner'] === 'true' }
      : null;
  });
  await app.register(registerPatchRoutes);
  await app.ready();
});

afterAll(async () => app.close());
beforeEach(() => vi.clearAllMocks());

describe('POST /api/patches/apply', () => {
  it('rejects unauthenticated and non-admin callers before invoking patch logic', async () => {
    const anonymous = await app.inject({
      method: 'POST', url: '/api/patches/apply',
      payload: { filePath: 'src/example.ts', patchContent: 'export {};' },
    });
    const memberResponse = await app.inject({
      method: 'POST', url: '/api/patches/apply', headers: member,
      payload: { filePath: 'src/example.ts', patchContent: 'export {};' },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(memberResponse.statusCode).toBe(403);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('rejects an administrator who is not the configured RyanAI owner', async () => {\n    const response = await app.inject({\n      method: 'POST', url: '/api/patches/apply', headers: { 'x-test-user': 'admin-2', 'x-test-role': 'admin', 'x-test-owner': 'false' },\n      payload: { filePath: 'src/example.ts', patchContent: 'export const ready = true;' },\n    });\n    expect(response.statusCode).toBe(403);\n    expect(patcher.proposePullRequest).not.toHaveBeenCalled();\n  });\n\n  it('creates a GitHub PR proposal instead of modifying the running workspace', async () => {
    patcher.proposePullRequest.mockResolvedValue({ status: 'proposed', message: 'PR created', pullRequestUrl: 'https://github.com/example/repo/pull/1' });
    const response = await app.inject({
      method: 'POST', url: '/api/patches/apply', headers: admin,
      payload: { filePath: 'src/example.ts', patchContent: 'export const ready = true;' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ success: true, result: { status: 'proposed', message: 'PR created', pullRequestUrl: 'https://github.com/example/repo/pull/1' } });
    expect(patcher.proposePullRequest).toHaveBeenCalledWith({
      filePath: 'src/example.ts', patchContent: 'export const ready = true;',
    });
  });

  it('returns conflict when the GitHub base branch changes', async () => {
    patcher.proposePullRequest.mockResolvedValue({ status: 'conflict', error: 'Base branch changed.' });
    const response = await app.inject({
      method: 'POST', url: '/api/patches/apply', headers: admin,
      payload: { filePath: 'src/example.ts', patchContent: 'export const ready = true;' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().success).toBe(false);
  });

  it('rejects invalid payloads before running the patch pipeline', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/patches/apply', headers: admin,
      payload: { targetId: '../.env', operations: [{ op: 'replace' }] },
    });
    expect(response.statusCode).toBe(400);
    expect(patcher.proposePullRequest).not.toHaveBeenCalled();
  });

  it('fails closed when GitHub patch integration is unavailable', async () => {
    patcher.proposePullRequest.mockResolvedValue({ status: 'unavailable', error: 'GitHub integration is not configured.' });
    const response = await app.inject({
      method: 'POST', url: '/api/patches/apply', headers: admin,
      payload: { filePath: 'src/example.ts', patchContent: 'export const ready = true;' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().success).toBe(false);
  });
});
