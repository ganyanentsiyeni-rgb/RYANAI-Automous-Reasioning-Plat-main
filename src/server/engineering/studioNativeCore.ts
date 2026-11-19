/**
 * RyanAI Studio Native Core.
 * Studio owns project/task/artifact lifecycle. Queue claims use Postgres row
 * locks and leases. Execution is fail-closed until a registered worker and
 * Gen-X policy bridge are supplied by the host runtime.
 */
import { Prisma, type StudioTask } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { RYANAI_WORKER_ROSTER } from '../../agent/workerRegistry.js';
import { findModuleAgentForTask } from '../../agent/moduleAgentRegistry.js';
import { evaluateRyanAIStudioTaskAdmission } from './ryanaiStudioTaskAdmission.js';

export type StudioProjectType = 'engineering' | 'research' | 'design' | 'data' | 'automation';
export interface CreateStudioProjectInput {
  ownerUserId: string; title: string; objective: string; projectType: StudioProjectType;
  initialTasks?: Array<{ title: string; objective: string; taskType: string; priority?: number; requiredCapabilities?: string[]; dependsOnIndexes?: number[] }>;
}

export function recommendStudioWorker(taskType: string, requiredCapabilities: readonly string[] = []) {
  const required = new Set([taskType, ...requiredCapabilities]);
  return RYANAI_WORKER_ROSTER.find((worker) => worker.taskTypes.some((candidate) => required.has(candidate))) ?? null;
}

export async function createStudioProject(input: CreateStudioProjectInput) {
  const tasks = input.initialTasks ?? [];
  for (const task of tasks) {
    if (!task.title.trim() || !task.objective.trim() || !/^[a-z][a-z0-9._-]{1,47}$/.test(task.taskType)) throw new Error('Each Studio task requires a title, objective and valid task type.');
    for (const dependency of task.dependsOnIndexes ?? []) if (!Number.isInteger(dependency) || dependency < 0 || dependency >= tasks.length || dependency === tasks.indexOf(task)) throw new Error('Task dependency index is invalid.');
  }
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number): void => {
    if (visiting.has(index)) throw new Error('Studio task plan contains a dependency cycle.');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const dependency of tasks[index].dependsOnIndexes ?? []) visit(dependency);
    visiting.delete(index); visited.add(index);
  };
  tasks.forEach((_, index) => visit(index));

  return prisma.$transaction(async (tx) => {
    const project = await tx.studioProject.create({ data: {
      ownerUserId: input.ownerUserId, title: input.title.trim(), objective: input.objective.trim(),
      projectType: input.projectType, status: tasks.length ? 'planned' : 'draft',
    } });
    const createdTasks: StudioTask[] = [];
    for (const task of tasks) {
      const assigned = recommendStudioWorker(task.taskType, task.requiredCapabilities);
      const moduleOwner = findModuleAgentForTask(task.taskType);
      const created = await tx.studioTask.create({ data: {
        projectId: project.id, ownerUserId: input.ownerUserId, title: task.title.trim(), objective: task.objective.trim(),
        taskType: task.taskType, priority: task.priority ?? 0, requiredCapabilities: task.requiredCapabilities ?? [],
        assignedWorkerId: assigned?.id ?? null, dependsOnIds: [], input: {
          projectType: input.projectType,
          accountableModuleAgentId: moduleOwner?.id ?? null,
          accountableModuleAgentName: moduleOwner?.name ?? null,
          sharedSpecialistWorkerId: assigned?.id ?? null,
        },
      } });
      createdTasks.push(created);
      await tx.studioEvent.create({ data: {
        projectId: project.id, taskId: created.id, ownerUserId: input.ownerUserId,
        actorId: input.ownerUserId,
        eventType: moduleOwner ? 'task.module_agent_assigned' : 'task.module_agent_unassigned',
        payload: {
          moduleAgentId: moduleOwner?.id ?? null,
          moduleAgentName: moduleOwner?.name ?? null,
          sharedSpecialistWorkerId: assigned?.id ?? null,
          taskType: task.taskType,
        },
      } });
    }
    for (let index = 0; index < tasks.length; index += 1) {
      const dependencies = (tasks[index].dependsOnIndexes ?? []).map((dependency) => createdTasks[dependency].id);
      if (dependencies.length) await tx.studioTask.update({ where: { id: createdTasks[index].id }, data: { dependsOnIds: dependencies } });
    }
    await tx.studioEvent.create({ data: {
      projectId: project.id, ownerUserId: input.ownerUserId, actorId: input.ownerUserId,
      eventType: 'project.created', payload: { taskCount: createdTasks.length, projectType: input.projectType },
    } });
    return { project, tasks: createdTasks };
  });
}

export async function listStudioProjects(ownerUserId: string) {
  return prisma.studioProject.findMany({
    where: { ownerUserId }, orderBy: { updatedAt: 'desc' }, take: 50,
    include: { tasks: { orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }, artifacts: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
}

const CLAIM_STUDIO_TASK_SQL = `
WITH candidate AS (
  SELECT task.id FROM studio_tasks AS task
  WHERE task.status = 'queued' AND task.available_at <= NOW()
    AND task.attempts < task.max_attempts
    AND task.task_type = ANY($1::text[])
    AND (NOT task.approval_required OR task.approval_status = 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(task.depends_on_ids) AS dependency_id
      LEFT JOIN studio_tasks AS dependency ON dependency.id = dependency_id
      WHERE dependency.id IS NULL OR dependency.status <> 'completed'
    )
  ORDER BY task.priority DESC, task.created_at ASC
  FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE studio_tasks AS task
SET status = 'running', lease_owner = $2,
    lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
    heartbeat_at = NOW(), started_at = COALESCE(task.started_at, NOW()),
    attempts = task.attempts + 1, updated_at = NOW()
FROM candidate WHERE task.id = candidate.id
RETURNING task.*;
`;

export async function claimStudioTask(workerId: string, supportedTaskTypes: readonly string[], leaseSeconds = 90) {
  if (!workerId.trim() || supportedTaskTypes.length === 0) return null;
  const safeLease = Math.max(15, Math.min(leaseSeconds, 600));
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRawUnsafe<StudioTask[]>(CLAIM_STUDIO_TASK_SQL, [...supportedTaskTypes], workerId, safeLease);
    if (claimed[0]) await tx.studioEvent.create({ data: {
      projectId: claimed[0].projectId, taskId: claimed[0].id, ownerUserId: claimed[0].ownerUserId,
      actorId: workerId, eventType: 'task.leased', payload: { attempt: claimed[0].attempts, leaseSeconds: safeLease },
    } });
    return claimed[0] ?? null;
  });
}

export async function heartbeatStudioTask(taskId: string, workerId: string, leaseSeconds = 90) {
  const safeLease = Math.max(15, Math.min(leaseSeconds, 600));
  const result = await prisma.studioTask.updateMany({
    where: { id: taskId, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } },
    data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + safeLease * 1000) },
  });
  return result.count === 1;
}

export async function recoverExpiredStudioLeases() {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const expired = await tx.studioTask.findMany({
      where: { status: 'running', leaseExpiresAt: { lte: now } },
      select: { id: true, projectId: true, ownerUserId: true, attempts: true, maxAttempts: true }, take: 250,
    });
    let recovered = 0;
    let failed = 0;
    for (const task of expired) {
      const exhausted = task.attempts >= task.maxAttempts;
      const updated = await tx.studioTask.updateMany({
        where: { id: task.id, status: 'running', leaseExpiresAt: { lte: now } },
        data: { status: exhausted ? 'failed' : 'queued', leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
          availableAt: exhausted ? now : new Date(Date.now() + Math.min(300000, 1000 * 2 ** task.attempts)),
          completedAt: exhausted ? now : null },
      });
      // Another recovery process may have won the conditional update. Only the
      // process that actually changes the lease may append its lifecycle event.
      if (updated.count !== 1) continue;
      if (exhausted) failed += 1;
      else recovered += 1;
      await tx.studioEvent.create({ data: {
        projectId: task.projectId, taskId: task.id, ownerUserId: task.ownerUserId,
        eventType: exhausted ? 'task.lease_exhausted' : 'task.lease_recovered',
        payload: { attempts: task.attempts, maxAttempts: task.maxAttempts },
      } });
    }
    return { inspected: expired.length, recovered, failed };
  });
}

export interface StudioWorkerContext { workerId: string; task: StudioTask; heartbeat: () => Promise<boolean>; }
export type StudioTaskHandler = (context: StudioWorkerContext) => Promise<unknown>;
const taskHandlers = new Map<string, StudioTaskHandler>();
export function registerStudioTaskHandler(taskType: string, handler: StudioTaskHandler) {
  if (!/^[a-z][a-z0-9._-]{1,47}$/.test(taskType) || typeof handler !== 'function') throw new Error('Invalid Studio task handler registration.');
  if (taskHandlers.has(taskType)) throw new Error('A Studio handler is already registered for ' + taskType + '.');
  taskHandlers.set(taskType, handler);
  return () => { if (taskHandlers.get(taskType) === handler) taskHandlers.delete(taskType); };
}

export async function runStudioWorkerOnce(workerId: string) {
  const task = await claimStudioTask(workerId, [...taskHandlers.keys()]);
  if (!task) return { state: 'idle' as const };
  const handler = taskHandlers.get(task.taskType);
  if (!handler) {
    await prisma.studioTask.updateMany({
      where: { id: task.id, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } },
      data: { status: 'queued', leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null },
    });
    return { state: 'unhandled' as const, taskId: task.id };
  }
  const decision = evaluateRyanAIStudioTaskAdmission(task);
  if (!decision.allowed) {
    await prisma.$transaction(async (tx) => {
      const blocked = await tx.studioTask.updateMany({ where: { id: task.id, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } },
        data: { status: 'blocked', leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, approvalStatus: 'blocked' } });
      if (blocked.count === 1) await tx.studioEvent.create({ data: { projectId: task.projectId, taskId: task.id, ownerUserId: task.ownerUserId,
        actorId: workerId, eventType: 'task.policy_blocked', payload: { decision: decision.decision ?? 'DENY_OR_REQUIRE_APPROVAL', ruleId: decision.ruleId ?? 'unknown', reason: decision.reason ?? 'RyanAI platform policy denied task admission.' } } });
    });
    return { state: 'blocked' as const, taskId: task.id };
  }
  await prisma.studioEvent.create({ data: {
    projectId: task.projectId, taskId: task.id, ownerUserId: task.ownerUserId,
    actorId: workerId, eventType: 'task.policy_authorized',
    payload: {
      decision: decision.decision ?? 'ALLOW',
      ruleId: decision.ruleId ?? 'unspecified',
      approvalReference: decision.approvalReference ?? null,
    },
  } });
  try {
    const output = await handler({ workerId, task, heartbeat: () => heartbeatStudioTask(task.id, workerId) });
    await prisma.$transaction(async (tx) => {
      const completed = await tx.studioTask.updateMany({ where: { id: task.id, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } },
        data: { status: 'completed', output: output as Prisma.InputJsonValue, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null } });
      if (completed.count !== 1) throw new Error('Studio worker lease expired before completion could be committed.');
      await tx.studioEvent.create({ data: { projectId: task.projectId, taskId: task.id, ownerUserId: task.ownerUserId,
        actorId: workerId, eventType: 'task.completed', payload: { attempt: task.attempts } } });
    });
    return { state: 'completed' as const, taskId: task.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio worker failed.';
    await prisma.$transaction(async (tx) => {
      const exhausted = task.attempts >= task.maxAttempts;
      const released = await tx.studioTask.updateMany({ where: { id: task.id, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: new Date() } },
        data: { status: exhausted ? 'failed' : 'queued', leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
          availableAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** task.attempts)) } });
      if (released.count === 1) await tx.studioEvent.create({ data: { projectId: task.projectId, taskId: task.id, ownerUserId: task.ownerUserId,
        actorId: workerId, eventType: 'task.execution_failed', payload: { attempt: task.attempts, error: message.slice(0, 1000) } } });
    });
    return { state: 'failed' as const, taskId: task.id, error: message };
  }
}

export interface StudioToolExecutionRequest {
  actorId: string; connectionRef: string; requestId: string; capabilityId: string; input: unknown;
  manifest: { capabilities: readonly { id: string; risk: 'read' | 'write' | 'outbound' | 'destructive'; requiresHumanApproval: boolean }[] };
  approval?: { reference: string };
  resolveConnection: (actorId: string, connectionRef: string) => Promise<boolean>;
  verifyApproval: (approval: { reference: string }, actorId: string, capabilityId: string) => Promise<boolean>;
  authorize: (request: StudioToolExecutionRequest) => Promise<{ allowed: boolean; reason?: string }>;
  execute: (request: StudioToolExecutionRequest) => Promise<unknown>;
  audit: (event: { actorId: string; requestId: string; capabilityId: string; outcome: string; reason?: string }) => Promise<void>;
}

/** Fail-closed contract. No HTTP route exposes this function or raw provider credentials. */
export async function executeStudioToolCapability(request: StudioToolExecutionRequest) {
  const capability = request.manifest.capabilities.find((item) => item.id === request.capabilityId);
  if (!capability) throw new Error('Capability is not declared by the provider manifest.');
  if (!request.actorId || !request.connectionRef || !request.requestId) throw new Error('A verified actor, server-side connection reference and request ID are required.');
  if (!await request.resolveConnection(request.actorId, request.connectionRef)) {
    await request.audit({ actorId: request.actorId, requestId: request.requestId, capabilityId: request.capabilityId, outcome: 'blocked', reason: 'Owner-scoped provider connection could not be resolved.' });
    throw new Error('Owner-scoped provider connection could not be resolved.');
  }
  if ((capability.risk !== 'read' || capability.requiresHumanApproval)
    && (!request.approval?.reference || !await request.verifyApproval(request.approval, request.actorId, request.capabilityId))) {
    await request.audit({ actorId: request.actorId, requestId: request.requestId, capabilityId: request.capabilityId, outcome: 'blocked', reason: 'Matching human approval is required.' });
    throw new Error('Matching human approval is required for this capability.');
  }
  const decision = await request.authorize(request);
  if (!decision.allowed) {
    await request.audit({ actorId: request.actorId, requestId: request.requestId, capabilityId: request.capabilityId, outcome: 'blocked', reason: decision.reason ?? 'RyanAI platform policy denied the request.' });
    throw new Error(decision.reason ?? 'RyanAI platform policy denied the request.');
  }
  const result = await request.execute(request);
  await request.audit({ actorId: request.actorId, requestId: request.requestId, capabilityId: request.capabilityId, outcome: 'completed' });
  return result;
}

export async function createStudioArtifact(input: {
  projectId: string; taskId?: string; ownerUserId: string; title: string; kind: string;
  storageProvider: string; storageKey: string; mimeType?: string; byteSize?: bigint; sha256?: string;
  provenance?: Prisma.InputJsonValue;
}) {
  const project = await prisma.studioProject.findFirst({ where: { id: input.projectId, ownerUserId: input.ownerUserId }, select: { id: true } });
  if (!project) throw new Error('Studio project not found for this owner.');
  if (input.taskId) {
    const task = await prisma.studioTask.findFirst({ where: { id: input.taskId, projectId: input.projectId, ownerUserId: input.ownerUserId }, select: { id: true } });
    if (!task) throw new Error('Studio task not found for this owner and project.');
  }
  return prisma.$transaction(async (tx) => {
    const artifact = await tx.studioArtifact.create({ data: {
      projectId: input.projectId, taskId: input.taskId, ownerUserId: input.ownerUserId,
      title: input.title, kind: input.kind, storageProvider: input.storageProvider, storageKey: input.storageKey,
      mimeType: input.mimeType, byteSize: input.byteSize, sha256: input.sha256, provenance: input.provenance ?? {},
    } });
    await tx.studioEvent.create({ data: {
      projectId: input.projectId, taskId: input.taskId, ownerUserId: input.ownerUserId,
      eventType: 'artifact.registered', payload: { artifactId: artifact.id, kind: artifact.kind, sha256: artifact.sha256 },
    } });
    return artifact;
  });
}

export async function getStudioDeliveryReadiness(projectId: string, ownerUserId: string) {
  const project = await prisma.studioProject.findFirst({
    where: { id: projectId, ownerUserId },
    include: { tasks: true, artifacts: true, events: { orderBy: { createdAt: 'desc' }, take: 100 } },
  });
  if (!project) return null;
  const blocked = project.tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length;
  const incomplete = project.tasks.filter((task) => task.status !== 'completed').length;
  const verifiedChecks = project.events.filter((event) => event.eventType === 'quality.check.passed').length;
  return {
    projectId: project.id,
    state: incomplete === 0 && blocked === 0 && verifiedChecks > 0 ? 'ready_for_human_review' : 'in_progress',
    tasks: { total: project.tasks.length, completed: project.tasks.length - incomplete, incomplete, failedOrBlocked: blocked },
    artifacts: project.artifacts.length, recordedPassedChecks: verifiedChecks,
    humanReviewRequired: true,
    note: 'Worker completion or artifact upload is not release approval. Delivery requires independently verifiable quality evidence and human review.',
  };
}

export function getStudioNativeRuntimeDescriptor() {
  return {
    projectLifecycle: 'studio_native',
    scheduler: 'database_leased_task_graph',
    workerRuntime: 'separate_process',
    workerHealth: 'unknown',
    workerHealthReason: 'The API process cannot observe worker-local handler registration or liveness. A shared worker heartbeat is not yet persisted.',
    pluginGateway: 'fail_closed_policy_and_approval_contract',
    authorizationAuthority: 'RyanAI platform policy',
    productionExecutionEnabled: false,
  } as const;
}
