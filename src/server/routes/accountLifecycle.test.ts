// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountLifecycleRoutes } from './accountLifecycle.js';

vi.mock('./auth.js', () => ({
  requireOwner: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers['x-test-owner'] !== 'owner') return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    request.authUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin', isOwner: true };
  },
}));

describe('owner account lifecycle request API', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  function makeApp() {
    const requestCreate = vi.fn().mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestType: 'role_change',
      targetUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      requestedRole: 'admin',
      status: 'pending',
      policyDecision: 'REQUIRE_APPROVAL',
      policyRuleId: 'GX-HIL-001',
      createdAt: new Date('2026-11-18T12:00:00Z'),
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      accountLifecycleRequest: { create: requestCreate },
      accountLifecycleAuditEvent: { create: auditCreate },
    }));
    const app = Fastify();
    apps.push(app);
    app.decorate('prisma', { $transaction: transaction, accountLifecycleRequest: { findMany: vi.fn().mockResolvedValue([]) } } as never);
    return { app, requestCreate, auditCreate, transaction };
  }

  it('rejects non-owner callers before request handling', async () => {
    const { app, transaction } = makeApp();
    await app.register(accountLifecycleRoutes);
    const response = await app.inject({ method: 'POST', url: '/api/admin/account-lifecycle-requests', payload: {} });
    expect(response.statusCode).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires a valid target, reason, and explicit owner confirmation', async () => {
    const { app, transaction } = makeApp();
    await app.register(accountLifecycleRoutes);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle-requests',
      headers: { 'x-test-owner': 'owner' },
      payload: { requestType: 'session_revocation', targetUserId: 'not-a-uuid', reason: 'Review sessions', confirmed: false },
    });
    expect(response.statusCode).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records a Gen-X evaluated request and append-only audit event without executing the lifecycle action', async () => {
    const { app, requestCreate, auditCreate, transaction } = makeApp();
    await app.register(accountLifecycleRoutes);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle-requests',
      headers: { 'x-test-owner': 'owner' },
      payload: {
        requestType: 'role_change',
        targetUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        requestedRole: 'admin',
        reason: 'Owner-reviewed access elevation request.',
        confirmed: true,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().request.policyDecision).toBe('REQUIRE_APPROVAL');
    expect(response.json().execution).toBe('disabled_pending_separate_implementation_and_approval');
    expect(response.json().message).toContain('No role, account status, or session has been changed.');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(requestCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestType: 'role_change',
        targetUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        requestedRole: 'admin',
        status: 'pending',
        policyDecision: 'REQUIRE_APPROVAL',
        policyRuleId: 'GX-HIL-001',
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        eventType: 'account.lifecycle.requested',
        details: expect.objectContaining({ ownerConfirmed: true, policyRuleId: 'GX-HIL-001' }),
      }),
    }));
  });
});
