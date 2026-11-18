// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminAccountLifecycleRoutes } from './adminAccountLifecycle.js';

vi.mock('./auth.js', () => ({
  requireOwner: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers['x-test-role'] !== 'owner') return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    request.authUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin', isOwner: true };
  },
}));

describe('owner account lifecycle request ledger', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function makeApp(events: Array<Record<string, unknown>> = []) {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const event = { ...data, id: 'event-' + (events.length + 1), createdAt: new Date('2026-11-18T12:00:00Z') };
      events.unshift(event);
      return event;
    });
    const findMany = vi.fn(async () => events);
    const queryRawUnsafe = vi.fn(async () => []);
    const prisma = {
      jarvisAuditEvent: { create, findMany },
      $queryRawUnsafe: queryRawUnsafe,
    };
    const transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.decorate('prisma', { ...prisma, $transaction: transaction } as never);
    return { app, create, findMany, queryRawUnsafe, transaction, events };
  }

  it('blocks administrators who are not the verified owner', async () => {
    const { app, create } = makeApp();
    await app.register(adminAccountLifecycleRoutes);
    const response = await app.inject({ method: 'GET', url: '/api/admin/account-lifecycle/requests', headers: { 'x-test-role': 'admin' } });
    expect(response.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires valid targets, a reason, and an allowed role before appending an event', async () => {
    const { app, create } = makeApp();
    await app.register(adminAccountLifecycleRoutes);
    const headers = { 'x-test-role': 'owner' };
    const base = { action: 'role_change', targetUserId: '123e4567-e89b-42d3-a456-426614174000', requestedRole: 'owner', reason: 'Change access for the team' };
    const badRole = await app.inject({ method: 'POST', url: '/api/admin/account-lifecycle/requests', headers, payload: base });
    expect(badRole.statusCode).toBe(400);
    const badTarget = await app.inject({ method: 'POST', url: '/api/admin/account-lifecycle/requests', headers, payload: { ...base, requestedRole: 'admin', targetUserId: 'not-a-uuid' } });
    expect(badTarget.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('records a pending role-change request and requires a separate request-specific confirmation', async () => {
    const { app, create, events } = makeApp();
    await app.register(adminAccountLifecycleRoutes);
    const headers = { 'x-test-role': 'owner' };
    const targetUserId = '123e4567-e89b-42d3-a456-426614174000';
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle/requests',
      headers,
      payload: { action: 'role_change', targetUserId, requestedRole: 'admin', reason: 'Promote approved support lead', },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ state: 'PENDING_OWNER_CONFIRMATION', accountMutationPerformed: false });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'ACCOUNT_LIFECYCLE_REQUESTED' }) }));

    const requestId = created.json().requestId as string;
    const wrong = await app.inject({
      method: 'POST', url: '/api/admin/account-lifecycle/requests/' + requestId + '/confirm',
      headers, payload: { confirmation: 'CONFIRM wrong' },
    });
    expect(wrong.statusCode).toBe(400);
    const confirmed = await app.inject({
      method: 'POST', url: '/api/admin/account-lifecycle/requests/' + requestId + '/confirm',
      headers, payload: { confirmation: 'CONFIRM ' + requestId },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ state: 'OWNER_CONFIRMED_PENDING_EXECUTION_REVIEW', accountMutationPerformed: false });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      'ryanai-account-lifecycle-confirm:' + requestId,
    );

    const replay = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle/requests/' + requestId + '/confirm',
      headers,
      payload: { confirmation: 'CONFIRM ' + requestId },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toContain('already been confirmed');
    expect(create).toHaveBeenCalledTimes(2); // request + exactly one confirmation
  });

  it('records session-revocation requests as capability-blocked without collecting another user token', async () => {
    const { app } = makeApp();
    await app.register(adminAccountLifecycleRoutes);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle/requests',
      headers: { 'x-test-role': 'owner' },
      payload: {
        action: 'revoke_sessions',
        targetUserId: '123e4567-e89b-42d3-a456-426614174000',
        reason: 'Revoke sessions after security incident',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ state: 'PENDING_OWNER_CONFIRMATION', accountMutationPerformed: false });
    expect(response.json().capabilityNote).toContain('will not collect or store another user');
    const requestId = response.json().requestId as string;
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/admin/account-lifecycle/requests/' + requestId + '/confirm',
      headers: { 'x-test-role': 'owner' },
      payload: { confirmation: 'CONFIRM ' + requestId },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ state: 'CONFIRMED_CAPABILITY_BLOCKED', accountMutationPerformed: false });
  });
});
