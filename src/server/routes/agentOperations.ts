import type { FastifyPluginAsync } from 'fastify';
import { dispatchAutonomousTask, getAgentTaskWorkerStatus, listAgentRuns, listBrainHealth, probeAllBrains } from '../../agent/operations.js';
import { getAgentPAStatus } from '../../skills/agentPAScript.js';
import { buildUserAwarenessSnapshot } from '../../agent/awareness/operationalAwarenessService.js';
import { listBrainKnowledge, publishBrainKnowledge } from '../../agent/knowledgeAgent.js';
import { normalizeOfflineTaskBatch } from '../../agent/offlineTaskSync.js';
import { createPADelegation, listPADelegations, getPADelegation, approvePADelegation, rejectPADelegation } from '../../agent/paDelegationService.js';
import { PA_DELEGATION_CAPABILITIES, type PADelegationCapability } from '../../agent/paJarvisHandshake.js';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { appendRunEvidence } from '../../agent/engineeringEvidence.js';
interface DispatchBody { objective: string; taskId?: string; }
interface OfflineSyncBody { tasks: Array<{ taskId: string; objective: string }>; }
interface PADelegationBody { objective: string; capabilities: PADelegationCapability[]; delegationId?: string; }
const PA_DELEGATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PA_CAPABILITY_POLICY: Record<PADelegationCapability, { toolName: string; action: 'READ' | 'CREATE' | 'UPDATE' | 'EXECUTE'; target: string }> = {
  'repository.inspect': { toolName: 'mcp_repository_status', action: 'READ', target: 'repository-status' },
  'diagnostics.run': { toolName: 'system_diagnostics', action: 'READ', target: 'system-diagnostics' },
  'patch.propose': { toolName: 'patch_proposal', action: 'CREATE', target: 'reviewable-patch-proposal' },
  'tests.run': { toolName: 'test_runner', action: 'EXECUTE', target: 'isolated-test-suite' },
  'evidence.record': { toolName: 'evidence_record', action: 'UPDATE', target: 'agent-run-evidence' },
};

function policyEnvironment(): 'development' | 'staging' | 'production' {
  return process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'staging' ? 'staging' : 'development';
}

function evaluatePADelegationCapabilities(principal: string, capabilities: PADelegationCapability[]) {
  return capabilities.map((capability) => {
    const policy = PA_CAPABILITY_POLICY[capability];
    const decision = evaluateGenXSecurityEvent({
      agentId: 'ryanai-pa', principal, toolName: policy.toolName, action: policy.action,
      target: 'pa:' + policy.target, environment: policyEnvironment(), actorType: 'human',
    });
    return { capability, decision: decision.decision, ruleId: decision.ruleId, reason: decision.reason };
  });
}
export const agentOperationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/agent/ops/pa/delegations', async (request, reply) => {
    if (!request.authUser?.id) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { delegations: await listPADelegations(request.authUser.id) };
  });
  fastify.post<{ Body: PADelegationBody }>('/api/agent/ops/pa/delegations', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: {
      type: 'object', required: ['objective', 'capabilities'], additionalProperties: false,
      properties: {
        objective: { type: 'string', minLength: 5, maxLength: 12000 },
        capabilities: { type: 'array', minItems: 1, maxItems: PA_DELEGATION_CAPABILITIES.length, uniqueItems: true, items: { type: 'string', enum: [...PA_DELEGATION_CAPABILITIES] } },
        delegationId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
    } } },
  }, async (request, reply) => {
    const user = request.authUser;
    if (!user?.id) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.body.objective.trim().length < 5) return reply.code(400).send({ error: 'Delegation objective must contain at least five non-whitespace characters.' });
    const decisions = evaluatePADelegationCapabilities(user.id, request.body.capabilities);
    const denied = decisions.find((item) => item.decision === 'DENY');
    if (denied) return reply.code(403).send({ error: 'Gen-X denied a requested PA capability.', ruleId: denied.ruleId, capability: denied.capability });
    try {
      const created = await createPADelegation({
        ownerUserId: user.id,
        delegationId: request.body.delegationId,
        objective: request.body.objective.trim(),
        capabilities: request.body.capabilities,
      });
      return reply.code(201).send({
        success: true,
        delegationId: created.delegation.id,
        taskId: created.run.id,
        status: 'pending_approval',
        policy: decisions,
        createdAt: created.delegation.createdAt,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'PA delegation proposal could not be persisted');
      return reply.code(503).send({ error: 'PA delegation proposal could not be saved.' });
    }
  });
  fastify.get<{ Params: { id: string } }>('/api/agent/ops/pa/delegations/:id', async (request, reply) => {
    if (!request.authUser?.id) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!PA_DELEGATION_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid PA delegation reference.' });
    const delegation = await getPADelegation(request.authUser.id, request.params.id);
    if (!delegation) return reply.code(404).send({ error: 'PA delegation not found.' });
    return { delegation };
  });
  fastify.post<{ Params: { id: string } }>('/api/agent/ops/pa/delegations/:id/approve', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => {
    const user = request.authUser;
    if (!user?.id) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!PA_DELEGATION_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid PA delegation reference.' });
    const delegation = await getPADelegation(user.id, request.params.id);
    if (!delegation) return reply.code(404).send({ error: 'PA delegation not found.' });
    const rawCapabilities = Array.isArray(delegation.requestedCapabilities) ? delegation.requestedCapabilities : [];
    const capabilities = rawCapabilities.filter((item): item is PADelegationCapability => typeof item === 'string' && PA_DELEGATION_CAPABILITIES.includes(item as PADelegationCapability));
    if (capabilities.length === 0 || capabilities.length !== rawCapabilities.length) return reply.code(400).send({ error: 'PA delegation has no valid capability scope.' });
    const reasoningPolicy = evaluateGenXSecurityEvent({
      agentId: 'ryanai-pa', principal: user.id, toolName: 'api_reasoning_request',
      action: 'NETWORK', target: 'configured-approved-provider', environment: policyEnvironment(), actorType: 'human',
    });
    if (reasoningPolicy.decision !== 'ALLOW') {
      return reply.code(403).send({ error: 'Gen-X denied reasoning-provider access for this delegation.', ruleId: reasoningPolicy.ruleId });
    }
    const decisions = evaluatePADelegationCapabilities(user.id, capabilities);
    const denied = decisions.find((item) => item.decision === 'DENY');
    if (denied) return reply.code(403).send({ error: 'Gen-X denied a requested PA capability.', ruleId: denied.ruleId, capability: denied.capability });
    try {
      const result = await approvePADelegation(user.id, request.params.id, user.id, decisions.map(({ capability, decision, ruleId }) => ({ capability, decision, ruleId })));
      if (!result) return reply.code(404).send({ error: 'PA delegation not found.' });
      return reply.code(202).send({ success: true, ...result, policy: decisions, reasoningPolicy: { decision: reasoningPolicy.decision, ruleId: reasoningPolicy.ruleId } });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'PA delegation cannot be approved.' });
    }
  });
  fastify.post<{ Params: { id: string } }>('/api/agent/ops/pa/delegations/:id/reject', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => {
    const user = request.authUser;
    if (!user?.id) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!PA_DELEGATION_ID.test(request.params.id)) return reply.code(400).send({ error: 'Invalid PA delegation reference.' });
    const rejected = await rejectPADelegation(user.id, request.params.id, user.id);
    return rejected ? { success: true, status: 'rejected' } : reply.code(404).send({ error: 'Pending PA delegation not found.' });
  });
  // Ordinary AgentRuns are fail-closed: queued work cannot reach the worker until
  // an authenticated administrator records an explicit approval bound to the exact plan.
  fastify.get('/api/agent/ops/approvals/pending', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    const runs = await fastify.prisma.agentRun.findMany({
      where: { queueType: 'reasoning', status: 'queued', approvalStatus: 'pending' },
      orderBy: { createdAt: 'asc' }, take: 100,
      select: { id: true, userId: true, objective: true, requestedModel: true, status: true, approvalStatus: true, planSnapshot: true, planHash: true, baseCommitSha: true, proposedDiffHash: true, createdAt: true },
    });
    return { approvals: runs };
  });

  fastify.post<{ Params: { id: string } }>('/api/agent/ops/tasks/:id/approve', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    const run = await fastify.prisma.agentRun.findUnique({ where: { id: request.params.id }, select: { id: true, userId: true, status: true, approvalStatus: true, planSnapshot: true, planHash: true, baseCommitSha: true, proposedDiffHash: true } });
    if (!run) return reply.code(404).send({ error: 'AgentRun not found.' });
    if (run.approvalStatus === 'approved') return { success: true, status: 'approved', alreadyApproved: true, taskId: run.id };
    if (run.approvalStatus !== 'pending' || run.status !== 'queued') return reply.code(409).send({ error: 'AgentRun is not awaiting approval.', status: run.status, approvalStatus: run.approvalStatus });
    if (run.planSnapshot !== null && (!run.planHash || !run.baseCommitSha || !run.proposedDiffHash)) return reply.code(409).send({ error: 'AgentRun has a plan snapshot but is missing immutable plan/commit/diff hashes; approval is blocked.', status: 'BLOCKED' });
    const now = new Date();
    const approved = await fastify.prisma.$transaction(async (tx) => {
      const changed = await tx.agentRun.updateMany({ where: { id: run.id, status: 'queued', approvalStatus: 'pending' }, data: { approvalStatus: 'approved', approvedBy: request.authUser!.id, approvedAt: now, approvedPlanHash: run.planSnapshot === null ? null : run.planHash, approvedCommitSha: run.planSnapshot === null ? null : run.baseCommitSha, approvedDiffHash: run.planSnapshot === null ? null : run.proposedDiffHash } });
      if (changed.count !== 1) return false;
      await appendRunEvidence(tx, { runId: run.id, eventType: 'approval.approved', actorId: request.authUser!.id, payload: { approvalStatus: 'approved', planHash: run.planHash, baseCommitSha: run.baseCommitSha, proposedDiffHash: run.proposedDiffHash } });
      return true;
    });
    if (!approved) return reply.code(409).send({ error: 'AgentRun approval changed concurrently; refresh and review again.' });
    try { await fastify.prisma.$queryRaw`SELECT pg_notify('agent_task_queue', ${request.params.id})`; } catch (error) { fastify.log.warn({ err: error, taskId: request.params.id }, 'Approved AgentRun queue notification failed; recovery sweep remains available.'); }
    return { success: true, status: 'approved', taskId: run.id, approvedBy: request.authUser.id, approvedAt: now };
  });

  fastify.post<{ Params: { id: string } }>('/api/agent/ops/tasks/:id/reject', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    const now = new Date();
    const rejected = await fastify.prisma.$transaction(async (tx) => {
      const changed = await tx.agentRun.updateMany({ where: { id: request.params.id, status: 'queued', approvalStatus: 'pending' }, data: { approvalStatus: 'rejected', status: 'cancelled', error: 'Rejected by administrator.', completedAt: now } });
      if (changed.count !== 1) return false;
      await appendRunEvidence(tx, { runId: request.params.id, eventType: 'approval.rejected', actorId: request.authUser!.id, payload: { approvalStatus: 'rejected' } });
      return true;
    });
    if (!rejected) return reply.code(409).send({ error: 'AgentRun is not awaiting approval or was already decided.' });
    return { success: true, status: 'rejected', taskId: request.params.id, approvedBy: request.authUser.id, decidedAt: now };
  });
  fastify.get('/api/agent/ops/knowledge', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    return { knowledge: await listBrainKnowledge() };
  });
  fastify.post<{ Body: { title: string; content: string; source?: string; category?: string; tags?: string[]; confidence?: number; priority?: number; expiresAt?: string } }>('/api/agent/ops/knowledge', {
    schema: {
      body: {
        type: 'object', required: ['title', 'content'], additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 200 },
          content: { type: 'string', minLength: 20, maxLength: 12000 },
          source: { type: 'string', maxLength: 500 },
          category: { type: 'string', maxLength: 80 },
          tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    const { expiresAt, ...input } = request.body;
    try {
      const item = await publishBrainKnowledge({ ...input, expiresAt: expiresAt ? new Date(expiresAt) : null });
      return reply.code(201).send({ success: true, knowledge: item });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : 'Invalid knowledge item.' });
    }
  });
  fastify.get('/api/agent/ops/pa/status', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    const pa = getAgentPAStatus();
    if (!pa) return reply.code(503).send({ status: 'unavailable', error: 'PA observer has not started.' });
    return { pa };
  });
  fastify.get('/api/agent/ops/brains', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { brains: await listBrainHealth(), timestamp: new Date().toISOString() };
  });
  fastify.post('/api/agent/ops/brains/probe', {
    config: { rateLimit: { max: 1, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (request.authUser.role !== 'admin') return reply.code(403).send({ error: 'Administrator access is required.' });
    return { brains: await probeAllBrains() };
  });
  fastify.post<{ Body: DispatchBody }>('/api/agent/ops/tasks', {
    schema: { body: { type: 'object', required: ['objective'], additionalProperties: false, properties: {
      objective: { type: 'string', minLength: 5, maxLength: 20000 },
      taskId: { type: 'string', format: 'uuid' },
    } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    try {
      const task = request.body.taskId
        ? await dispatchAutonomousTask(request.authUser.id, request.body.objective.trim(), undefined, undefined, request.body.taskId)
        : await dispatchAutonomousTask(request.authUser.id, request.body.objective.trim());
      return reply.code(202).send({ success: true, taskId: task.id, status: task.status, createdAt: task.createdAt });
    } catch (error) {
      fastify.log.error({ err: error }, 'Autonomous agent task enqueue failed');
      return reply.code(503).send({ status: 'failed', error: 'Task could not be queued. Inspect database and worker health.' });
    }
  });
  fastify.post<{ Body: OfflineSyncBody }>('/api/agent/ops/tasks/sync', {
    schema: { body: { type: 'object', required: ['tasks'], additionalProperties: false, properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 20, items: {
        type: 'object', required: ['taskId', 'objective'], additionalProperties: false,
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          objective: { type: 'string', minLength: 5, maxLength: 20000 },
        },
      } },
    } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    let tasks: ReturnType<typeof normalizeOfflineTaskBatch>;
    try {
      tasks = normalizeOfflineTaskBatch(request.body.tasks);
    } catch (error) {
      return reply.code(400).send({ status: 'rejected', error: error instanceof Error ? error.message : 'Invalid offline sync batch.' });
    }
    const results = [];
    for (const taskInput of tasks) {
      try {
        const task = await dispatchAutonomousTask(request.authUser.id, taskInput.objective, undefined, undefined, taskInput.taskId);
        results.push({ taskId: task.id, status: task.status, accepted: true, createdAt: task.createdAt });
      } catch (error) {
        fastify.log.warn({ err: error, taskId: taskInput.taskId }, 'Offline task replay was rejected');
        results.push({ taskId: taskInput.taskId, status: 'rejected', accepted: false });
      }
    }
    const accepted = results.filter((item) => item.accepted).length;
    return reply.code(accepted === results.length ? 202 : accepted > 0 ? 207 : 503).send({
      status: accepted === results.length ? 'accepted' : accepted > 0 ? 'partially_accepted' : 'unavailable',
      accepted,
      rejected: results.length - accepted,
      results,
      replaySafe: true,
    });
  });
  fastify.get('/api/agent/ops/awareness', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });

    // Keep each observer independent: one failed probe must not erase evidence from
    // the other sources. A failed task query is never represented as an empty queue.
    const [runsResult, databaseResult, workerResult, queueResult] = await Promise.allSettled([
      listAgentRuns(request.authUser.id),
      fastify.prisma.$queryRawUnsafe('SELECT 1 AS ok'),
      Promise.resolve().then(() => getAgentTaskWorkerStatus()),
      fastify.prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(
        "SELECT status, COUNT(*)::int AS count FROM public.agent_runs WHERE queue_type = 'reasoning' GROUP BY status",
      ),
    ]);

    const taskRunsAvailable = runsResult.status === 'fulfilled';
    const databaseOnline = databaseResult.status === 'fulfilled'
      && Array.isArray(databaseResult.value)
      && databaseResult.value.length > 0;
    const workerAvailable = workerResult.status === 'fulfilled';
    const runs = taskRunsAvailable ? runsResult.value : [];
    const workerStatus = workerAvailable ? workerResult.value : {
      state: 'not_started' as const,
      queueClaimState: 'unknown' as const,
      lastClaimAttemptAt: null,
      lastSuccessfulClaimAt: null,
      lastClaimError: null,
      lastClaimErrorCode: null,
      workerId: null,
      startedAt: null,
      recoveryIntervalMs: null,
      listener: null,
      lastNotificationAt: null,
      lastNotificationPayload: null,
      lastRecoverySweepAt: null,
      lastClaimedTask: null,
      lastProcessedTask: null,
    };
    const workerReady = workerAvailable
      && workerStatus.state === 'running'
      && workerStatus.queueClaimState === 'ready'
      && workerStatus.lastSuccessfulClaimAt !== null
      && workerStatus.listener?.connected === true
      && workerStatus.listener.subscribed === true;
    const connectivity = taskRunsAvailable && databaseOnline && workerReady ? 'online' : 'degraded';
    const queueAvailable = queueResult.status === 'fulfilled';
    const queueCounts = queueAvailable
      ? Object.fromEntries(queueResult.value.map((row) => [row.status, row.count]))
      : {};
    const globalQueue = {
      available: queueAvailable,
      queued: typeof queueCounts.queued === 'number' ? queueCounts.queued : null,
      running: typeof queueCounts.running === 'number' ? queueCounts.running : null,
      failed: typeof queueCounts.failed === 'number' ? queueCounts.failed : null,
      cancelled: typeof queueCounts.cancelled === 'number' ? queueCounts.cancelled : null,
      total: queueAvailable ? Object.values(queueCounts).reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0) : null,
    };

    if (!taskRunsAvailable) {
      fastify.log.warn({ err: runsResult.reason }, 'Operational awareness task source is unavailable');
    }
    if (databaseResult.status === 'rejected') {
      fastify.log.warn({ err: databaseResult.reason }, 'Operational awareness database probe failed');
    } else if (!databaseOnline) {
      fastify.log.warn('Operational awareness database probe returned no confirmation');
    }
    if (!workerAvailable) {
      fastify.log.warn({ err: workerResult.reason }, 'Operational awareness worker observer is unavailable');
    }

    return {
      ...buildUserAwarenessSnapshot(runs, workerStatus, connectivity),
      status: connectivity === 'online' ? 'online' : 'degraded',
      databaseConnectivity: databaseOnline ? 'online' : 'degraded',
      sources: {
        taskRuns: taskRunsAvailable ? 'available' : 'unavailable',
        database: databaseOnline ? 'available' : 'unavailable',
        worker: workerAvailable ? 'available' : 'unavailable',
        globalQueue: queueAvailable ? 'available' : 'unavailable',
      },
      globalQueue,
    };
  });
  fastify.get('/api/agent/ops/tasks', async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: 'Sign in to continue.' });
    return { tasks: await listAgentRuns(request.authUser.id) };
  });
};
