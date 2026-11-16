import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRunFindMany: vi.fn(),
  codingTaskFindMany: vi.fn(),
  providerConnectionFindMany: vi.fn(),
  workerStatus: vi.fn(),
  dispatchAutonomousTask: vi.fn(),
  createStudioProject: vi.fn(),
  listStudioProjects: vi.fn(),
  getStudioDeliveryReadiness: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    agentRun: { findMany: mocks.agentRunFindMany },
    codingTask: { findMany: mocks.codingTaskFindMany },
    pluginProviderConnection: { findMany: mocks.providerConnectionFindMany },
  },
}));
vi.mock('../../agent/operations.js', () => ({
  getAgentTaskWorkerStatus: mocks.workerStatus,
  dispatchAutonomousTask: mocks.dispatchAutonomousTask,
}));
vi.mock('../engineering/studioNativeCore.js', () => ({
  createStudioProject: mocks.createStudioProject,
  listStudioProjects: mocks.listStudioProjects,
  getStudioDeliveryReadiness: mocks.getStudioDeliveryReadiness,
  getStudioNativeRuntimeDescriptor: () => ({ projectLifecycle: 'studio_native', scheduler: 'database_leased_task_graph', workerRuntime: 'not_configured', authorizationAuthority: 'Gen-X', productionExecutionEnabled: false }),
}));
vi.mock('./auth.js', () => ({
  requireUser: async (request: { headers: Record<string, string | undefined>; authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    const userId = request.headers['x-test-user'];
    if (!userId) return reply.code(401).send({ error: 'Sign in to continue.' });
    request.authUser = { id: userId, role: 'user' };
  },
}));

import { engineeringEvidenceRoutes } from './engineeringEvidenceRoutes.js';

describe('RyanAI Studio overview API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.agentRunFindMany.mockResolvedValue([{
      id: 'project-1', objective: 'Build a service', queueType: 'agent', status: 'queued',
      approvalStatus: 'pending', createdAt: new Date(), completedAt: null, error: null,
      result: null, handoffs: [{ id: 'handoff-1', fromAgent: 'supervisor', toAgent: 'primary', status: 'running', completedAt: null, error: null }],
    }]);
    mocks.codingTaskFindMany.mockResolvedValue([{ id: 'coding-1', workbenchRunId: 'project-1', agent: 'codex', workspaceKey: 'workspace-1', status: 'running', attempts: 1, maxAttempts: 3, workerId: 'worker-1', createdAt: new Date(), updatedAt: new Date(), completedAt: null, error: null, result: null, leaseExpiresAt: new Date() }]);
    mocks.providerConnectionFindMany.mockResolvedValue([{
      providerId: 'google-calendar', status: 'connected', grantedScopes: ['calendar.readonly'],
      connectedAt: new Date(), revokedAt: null, updatedAt: new Date(),
      accessTokenExpiresAt: new Date(Date.now() + 60_000), encryptedRefreshToken: 'encrypted-refresh-token',
    }]);
    mocks.dispatchAutonomousTask.mockResolvedValue({ id: 'studio-project-1', status: 'queued' });
    mocks.createStudioProject.mockResolvedValue({ project: { id: 'native-project-1', title: 'Build Studio' }, tasks: [{ id: 'native-task-1', taskType: 'engineering' }] });
    mocks.listStudioProjects.mockResolvedValue([{ id: 'native-project-1', ownerUserId: 'owner-1' }]);
    mocks.getStudioDeliveryReadiness.mockResolvedValue({ projectId: 'native-project-1', state: 'in_progress', humanReviewRequired: true });
    mocks.workerStatus.mockReturnValue({
      state: 'running',
      queueClaimState: 'ready',
      lastClaimAttemptAt: new Date().toISOString(),
      lastSuccessfulClaimAt: new Date().toISOString(),
      lastClaimErrorCode: null,
      lastClaimedTask: { runId: 'run-claimed', trigger: 'notification', claimedAt: new Date().toISOString() },
      lastProcessedTask: { runId: 'run-processed', trigger: 'notification', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'completed' },
      listener: { state: 'listening', connected: true, subscribed: true, lastConnectedAt: new Date(), lastErrorCode: null },
    });
    app = Fastify();
    app.decorateRequest('authUser', null);
    await app.register(engineeringEvidenceRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates an owner-scoped native Studio project and task graph without dispatching Jarvis', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/engineering/studio/native/projects',
      headers: { 'x-test-user': 'owner-native' },
      payload: {
        title: 'Build Studio', objective: 'Build an independent project workspace', projectType: 'engineering',
        initialTasks: [{ title: 'Research architecture', objective: 'Compare scheduler designs', taskType: 'research' }],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(mocks.createStudioProject).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-native', title: 'Build Studio' }));
    expect(mocks.dispatchAutonomousTask).not.toHaveBeenCalled();
    expect(response.json().runtime).toMatchObject({ projectLifecycle: 'studio_native', productionExecutionEnabled: false });
  });

  it('lists only native Studio projects through the authenticated owner context', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/engineering/studio/native/projects', headers: { 'x-test-user': 'owner-native' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.listStudioProjects).toHaveBeenCalledWith('owner-native');
  });

  it('returns delivery readiness only for the authenticated project owner', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/engineering/studio/native/projects/native-project-1/delivery', headers: { 'x-test-user': 'owner-native' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.getStudioDeliveryReadiness).toHaveBeenCalledWith('native-project-1', 'owner-native');
    expect(response.json().humanReviewRequired).toBe(true);
  });

  it('submits structured briefs through the Studio execution adapter', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/engineering/studio/projects',
      headers: { 'x-test-user': 'owner-1' },
      payload: {
        objective: 'Build and verify a responsive API dashboard',
        projectType: 'engineering',
        deliverables: ['Architecture plan', 'Working implementation', 'Regression tests'],
        acceptanceCriteria: ['Typecheck passes', 'Owner isolation is verified'],
        constraints: ['No production deployment'],
      },
    });
    expect(response.statusCode).toBe(202);
    expect(mocks.dispatchAutonomousTask).toHaveBeenCalledWith(
      'owner-1',
      expect.stringContaining('Project type: engineering'),
    );
    expect(mocks.dispatchAutonomousTask.mock.calls[0][1]).toContain('Acceptance criteria:');
    expect(response.json()).toMatchObject({
      projectId: 'studio-project-1', taskId: 'studio-project-1', status: 'queued', queue: 'agent_runs',
      executionAdapter: { adapterId: 'jarvis-agent-runs', independentRuntime: false, lifecycleOwner: 'RyanAI Studio' },
    });
  });

  it('adds primary-source and provenance requirements to research briefs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/engineering/studio/projects',
      headers: { 'x-test-user': 'owner-1' },
      payload: {
        objective: 'Compare current approaches to reliable agent evaluation',
        projectType: 'research',
      },
    });
    expect(response.statusCode).toBe(202);
    const brief = mocks.dispatchAutonomousTask.mock.calls[0][1] as string;
    expect(brief).toContain('Research quality: prioritize primary sources');
    expect(brief).toContain('source URLs and publication/access dates');
    expect(brief).toContain('state uncertainty and evidence gaps');
  });

  it('rejects credential material in project briefs before dispatch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/engineering/studio/projects',
      headers: { 'x-test-user': 'owner-1' },
      payload: { objective: 'Research a provider', projectType: 'research', constraints: ['ghp_123456789012345678901234567890'] },
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.dispatchAutonomousTask).not.toHaveBeenCalled();
  });

  it('does not create a Studio project without an authenticated owner', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/engineering/studio/projects',
      payload: { objective: 'Research a provider', projectType: 'research' },
    });
    expect(response.statusCode).toBe(401);
    expect(mocks.dispatchAutonomousTask).not.toHaveBeenCalled();
  });

  it('requires a verified signed-in owner', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/engineering/studio/overview' });
    expect(response.statusCode).toBe(401);
    expect(mocks.agentRunFindMany).not.toHaveBeenCalled();
    expect(mocks.codingTaskFindMany).not.toHaveBeenCalled();
  });

  it('returns canonical workforce, live runtime, owner projects, tasks and truthful plugin readiness', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/engineering/studio/overview',
      headers: { 'x-test-user': 'owner-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.agentRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-1' } }));
    expect(mocks.codingTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-1' } }));
    expect(mocks.providerConnectionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'owner-1' } }));
    const body = response.json();
    expect(body.workforce.moduleAgents).toHaveLength(12);
    expect(body.workforce.sharedWorkers).toHaveLength(10);
    expect(body.runtime).toMatchObject({
      state: 'running', queueClaimState: 'ready',
      lastClaimedTask: { runId: 'run-claimed', trigger: 'notification' },
      lastProcessedTask: { runId: 'run-processed', status: 'completed' },
      listener: { connected: true, subscribed: true },
    });
    expect(body.execution).toMatchObject({ adapterId: 'jarvis-agent-runs', independentRuntime: false, lifecycleOwner: 'RyanAI Studio', authorizationAuthority: 'Gen-X' });
    expect(body.projects[0]).toMatchObject({
      id: 'project-1', objective: 'Build a service',
      handoffs: [{ fromAgent: 'supervisor', toAgent: 'primary', status: 'running' }],
    });
    expect(body.codingTasks[0]).toMatchObject({ id: 'coding-1', status: 'running' });
    const calendar = body.integrations.providers.find((provider: { id: string }) => provider.id === 'google-calendar');
    expect(calendar).toMatchObject({ connectionStatus: 'connected', adapterStatus: 'adapter_required', usable: false, state: 'blocked_adapter_required', healthState: 'not_probed', authorizationState: 'genx_per_invocation_required', executionAuthorized: false });
    expect(calendar.capabilities[0]).toMatchObject({ state: 'blocked_adapter_required', healthState: 'not_probed', executionAuthorized: false });
    expect(calendar).toMatchObject({ connectionStatus: 'connected', authenticationStatus: 'oauth_grant_issued', healthStatus: 'not_probed', executionStatus: 'blocked_adapter_missing', adapterStatus: 'adapter_required', usable: false });
    expect(JSON.stringify(body)).not.toContain('encryptedAccessToken');
  });

  it('fails closed for expired or unknown provider token expiry without exposing credential ciphertext', async () => {
    mocks.providerConnectionFindMany.mockResolvedValue([
      {
        providerId: 'google-calendar', status: 'connected', grantedScopes: ['calendar.readonly'],
        connectedAt: new Date(), revokedAt: null, updatedAt: new Date(),
        accessTokenExpiresAt: new Date(Date.now() - 60_000), encryptedRefreshToken: 'encrypted-refresh-token',
      },
      {
        providerId: 'microsoft-365-calendar', status: 'connected', grantedScopes: ['Calendars.Read'],
        connectedAt: new Date(), revokedAt: null, updatedAt: new Date(),
        accessTokenExpiresAt: new Date(Date.now() - 60_000), encryptedRefreshToken: null,
      },
      {
        providerId: 'gmail', status: 'connected', grantedScopes: ['messages.read'],
        connectedAt: new Date(), revokedAt: null, updatedAt: new Date(),
        accessTokenExpiresAt: null, encryptedRefreshToken: 'encrypted-refresh-token',
      },
    ]);
    const response = await app.inject({
      method: 'GET', url: '/api/engineering/studio/overview',
      headers: { 'x-test-user': 'owner-1' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const calendar = body.integrations.providers.find((provider: { id: string }) => provider.id === 'google-calendar');
    const microsoft = body.integrations.providers.find((provider: { id: string }) => provider.id === 'microsoft-365-calendar');
    const gmail = body.integrations.providers.find((provider: { id: string }) => provider.id === 'gmail');
    expect(calendar).toMatchObject({ connectionStatus: 'refresh_required', authenticationStatus: 'expired', healthStatus: 'not_probed', executionStatus: 'blocked_adapter_missing', usable: false });
    expect(microsoft).toMatchObject({ connectionStatus: 'reauthorization_required', authenticationStatus: 'reauthorization_required', healthStatus: 'not_probed', executionStatus: 'blocked_adapter_missing', usable: false });
    expect(gmail).toMatchObject({ connectionStatus: 'expiry_unknown', authenticationStatus: 'expiry_unknown', healthStatus: 'not_probed', executionStatus: 'blocked_adapter_missing', usable: false });
    expect(JSON.stringify(body)).not.toContain('encrypted-refresh-token');
  });

  it('lists only the authenticated owner’s coding tasks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/engineering/coding-tasks',
      headers: { 'x-test-user': 'owner-2' },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.codingTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-2' } }));
    expect(response.json().tasks).toHaveLength(1);
  });
});
