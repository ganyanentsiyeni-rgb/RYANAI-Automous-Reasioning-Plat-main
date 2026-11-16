import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const paService = vi.hoisted(() => ({
  createPADelegation: vi.fn(), listPADelegations: vi.fn(), getPADelegation: vi.fn(),
  approvePADelegation: vi.fn(), rejectPADelegation: vi.fn(),
}));
const genx = vi.hoisted(() => ({ evaluateGenXSecurityEvent: vi.fn() }));
const operations = vi.hoisted(() => ({
  dispatchAutonomousTask: vi.fn(),
  listAgentRuns: vi.fn(),
  listBrainHealth: vi.fn(),
  probeAllBrains: vi.fn(),
  listBrainKnowledge: vi.fn(),
  publishBrainKnowledge: vi.fn(),
}));
vi.mock('../../agent/operations.js', () => operations);
vi.mock('../../agent/paDelegationService.js', () => paService);
vi.mock('../../security/genxPolicy.js', () => genx);
vi.mock('../../agent/knowledgeAgent.js', () => ({
  listBrainKnowledge: operations.listBrainKnowledge,
  publishBrainKnowledge: operations.publishBrainKnowledge,
}));
import { agentOperationsRoutes } from './agentOperations.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user'];
    const role = request.headers['x-test-role'];
    (request as unknown as { authUser: unknown }).authUser = id ? { id: String(id), role: role === 'admin' ? 'admin' : 'user' } : null;
  });
  await app.register(agentOperationsRoutes);
});
afterAll(() => app.close());
beforeEach(() => {
  vi.clearAllMocks();
  genx.evaluateGenXSecurityEvent.mockImplementation((event: { action: string; toolName: string }) => {
    if (event.action === 'EXECUTE') return { decision: 'DENY', ruleId: 'GX-EXEC-001', reason: 'Execution is denied.', severity: 'CRITICAL' };
    if (event.action === 'CREATE' || event.action === 'UPDATE') return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-HIL-001', reason: 'Human approval required.', severity: 'HIGH' };
    if (event.toolName === 'api_reasoning_request') return { decision: 'ALLOW', ruleId: 'GX-HUMAN-REASONING-001', reason: 'Approved provider reasoning.', severity: 'LOW' };
    return { decision: 'ALLOW', ruleId: 'GX-READ-001', reason: 'Read-only access.', severity: 'LOW' };
  });
});

describe('agent operations routes', () => {
  it('denies knowledge publication to authenticated non-admin users', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/knowledge',
      headers: { 'x-test-user': 'user-1' },
      payload: { title: 'Platform policy', content: 'A sufficiently detailed knowledge record for the platform.' },
    });
    expect(response.statusCode).toBe(403);
    expect(operations.publishBrainKnowledge).not.toHaveBeenCalled();
  });
  it('allows admins to publish knowledge for all reasoning brains', async () => {
    operations.publishBrainKnowledge.mockResolvedValue({ id: 'knowledge-1', title: 'Platform policy' });
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/knowledge',
      headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' },
      payload: { title: 'Platform policy', content: 'A sufficiently detailed knowledge record for the platform.', tags: ['security'] },
    });
    expect(response.statusCode).toBe(201);
    expect(operations.publishBrainKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Platform policy', tags: ['security'], expiresAt: null,
    }));
  });
  it('lists shared knowledge only for administrators', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/agent/ops/knowledge', headers: { 'x-test-user': 'user-1' } });
    expect(denied.statusCode).toBe(403);
    operations.listBrainKnowledge.mockResolvedValue([{ id: 'knowledge-1' }]);
    const allowed = await app.inject({ method: 'GET', url: '/api/agent/ops/knowledge', headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().knowledge).toHaveLength(1);
  });

  it('returns a server-timestamped brain snapshot to an authenticated member', async () => {
    operations.listBrainHealth.mockResolvedValue([
      { brain: 'primary', status: 'HEALTHY', checkedAt: new Date(), lastSuccessAt: new Date() },
    ]);
    const before = Date.now();
    const response = await app.inject({
      method: 'GET',
      url: '/api/agent/ops/brains',
      headers: { 'x-test-user': 'user-1' },
    });
    const timestamp = Date.parse(response.json().timestamp);
    expect(response.statusCode).toBe(200);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
    expect(response.json().brains).toHaveLength(1);
  });

  it('restricts live provider probes to administrators', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/agent/ops/brains/probe', headers: { 'x-test-user': 'user-1' } });
    expect(denied.statusCode).toBe(403);
    expect(operations.probeAllBrains).not.toHaveBeenCalled();
    operations.probeAllBrains.mockResolvedValue([{ brain: 'primary', status: 'HEALTHY' }]);
    const allowed = await app.inject({ method: 'POST', url: '/api/agent/ops/brains/probe', headers: { 'x-test-user': 'admin-1', 'x-test-role': 'admin' } });
    expect(allowed.statusCode).toBe(200);
    expect(operations.probeAllBrains).toHaveBeenCalledTimes(1);
  });

  it('requires authentication before dispatch', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', payload: { objective: 'Run a test task' } });
    expect(response.statusCode).toBe(401);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('queues work for the authenticated user without waiting for model execution', async () => {
    operations.dispatchAutonomousTask.mockResolvedValue({ id: 'run-1', status: 'queued', createdAt: new Date('2026-10-30T08:00:00.000Z') });
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-1' }, payload: { objective: 'Analyze this architecture' } });
    expect(response.statusCode).toBe(202);
    expect(operations.dispatchAutonomousTask).toHaveBeenCalledWith('user-1', 'Analyze this architecture');
    expect(response.json()).toMatchObject({ taskId: 'run-1', status: 'queued' });
  });
  it('creates an Alex delegation as pending approval and records Gen-X scope decisions', async () => {
    paService.createPADelegation.mockResolvedValue({
      delegation: { id: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', createdAt: new Date('2026-11-08T00:00:00.000Z') },
      run: { id: 'run-1' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/pa/delegations',
      headers: { 'x-test-user': 'user-1' },
      payload: { objective: 'Inspect the API health and prepare a reviewed recommendation.', capabilities: ['repository.inspect', 'patch.propose'] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ delegationId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', taskId: 'run-1', status: 'pending_approval' });
    expect(paService.createPADelegation).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-1',
      objective: 'Inspect the API health and prepare a reviewed recommendation.',
      capabilities: ['repository.inspect', 'patch.propose'],
    }));
    expect(genx.evaluateGenXSecurityEvent).toHaveBeenCalledTimes(2);
  });

  it('denies PA capabilities that Gen-X marks as arbitrary execution', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/pa/delegations',
      headers: { 'x-test-user': 'user-1' },
      payload: { objective: 'Run tests directly on the host machine.', capabilities: ['tests.run'] },
    });
    expect(response.statusCode).toBe(403);
    expect(paService.createPADelegation).not.toHaveBeenCalled();
  });

  it('approves a pending delegation only after Gen-X permits configured-provider reasoning', async () => {
    paService.getPADelegation.mockResolvedValue({
      id: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101',
      requestedCapabilities: ['repository.inspect', 'patch.propose'],
    });
    paService.approvePADelegation.mockResolvedValue({
      delegationId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', runId: 'run-1', status: 'queued', alreadyApproved: false, notification: 'sent',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/pa/delegations/8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101/approve',
      headers: { 'x-test-user': 'user-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ success: true, delegationId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', status: 'queued' });
    expect(paService.approvePADelegation).toHaveBeenCalledWith('user-1', '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', 'user-1', expect.arrayContaining([
      expect.objectContaining({ capability: 'repository.inspect', decision: 'ALLOW' }),
      expect.objectContaining({ capability: 'patch.propose', decision: 'REQUIRE_APPROVAL' }),
    ]));
  });

  it('lists only the authenticated user’s PA delegations', async () => {
    paService.listPADelegations.mockResolvedValue([{ id: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101' }]);
    const response = await app.inject({ method: 'GET', url: '/api/agent/ops/pa/delegations', headers: { 'x-test-user': 'user-2' } });
    expect(response.statusCode).toBe(200);
    expect(paService.listPADelegations).toHaveBeenCalledWith('user-2');
    expect(response.json().delegations).toHaveLength(1);
  });

  it('rejects a pending PA delegation for its authenticated owner', async () => {
    paService.rejectPADelegation.mockResolvedValue(true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/ops/pa/delegations/8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101/reject',
      headers: { 'x-test-user': 'user-1' },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, status: 'rejected' });
    expect(paService.rejectPADelegation).toHaveBeenCalledWith('user-1', '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', 'user-1');
  });

  it('accepts an authenticated offline replay batch with stable task IDs', async () => {
    operations.dispatchAutonomousTask.mockImplementation(async (_userId, objective, _scope, _model, taskId) => ({
      id: taskId ?? 'generated-run', status: 'queued', objective, createdAt: new Date('2026-11-07T20:00:00.000Z'),
    }));
    const taskId = '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101';
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/tasks/sync',
      headers: { 'x-test-user': 'user-1' },
      payload: { tasks: [{ taskId, objective: '  Resume my report  ' }] },
    });
    expect(response.statusCode).toBe(202);
    expect(operations.dispatchAutonomousTask).toHaveBeenCalledWith('user-1', 'Resume my report', undefined, undefined, taskId);
    expect(response.json()).toMatchObject({ status: 'accepted', accepted: 1, rejected: 0, replaySafe: true });
  });
  it('rejects unauthenticated offline replay before persistence', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/tasks/sync',
      payload: { tasks: [{ taskId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', objective: 'Resume my report' }] },
    });
    expect(response.statusCode).toBe(401);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('rejects duplicate task IDs in an offline batch before persistence', async () => {
    const task = { taskId: '8b5d2f0a-3f42-4c9a-8a71-1a9e9f55b101', objective: 'Resume my report' };
    const response = await app.inject({
      method: 'POST', url: '/api/agent/ops/tasks/sync',
      headers: { 'x-test-user': 'user-1' },
      payload: { tasks: [task, task] },
    });
    expect(response.statusCode).toBe(400);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('rejects objectives shorter than the API contract', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-1' }, payload: { objective: 'no' } });
    expect(response.statusCode).toBe(400);
    expect(operations.dispatchAutonomousTask).not.toHaveBeenCalled();
  });
  it('scopes execution history to the authenticated user', async () => {
    operations.listAgentRuns.mockResolvedValue([]);
    const response = await app.inject({ method: 'GET', url: '/api/agent/ops/tasks', headers: { 'x-test-user': 'user-2' } });
    expect(response.statusCode).toBe(200);
    expect(operations.listAgentRuns).toHaveBeenCalledWith('user-2');
  });
});
