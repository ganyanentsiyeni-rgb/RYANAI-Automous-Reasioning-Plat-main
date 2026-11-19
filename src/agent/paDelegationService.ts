import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { captureQueueTraceContextForStorage } from '../telemetry/queueContext.js';
import { appendRunEvidence } from './engineeringEvidence.js';
import { publishAgentTaskNotification } from './queueNotifications.js';
import { resolvePAApprovalTransition } from './paDelegationApproval.js';
import {
  signAgentIdentityProof,
  verifyPAIdentityProof,
  PA_DELEGATION_CAPABILITIES,
  JARVIS_IDENTITY,
  type PADelegationCapability,
  type NonceConsumer,
} from './paJarvisHandshake.js';

const secret = () => process.env.PA_JARVIS_IDENTITY_SECRET?.trim() || '';

export function requirePAIdentitySecret(): string {
  const value = secret();
  if (Buffer.byteLength(value, 'utf8') < 32) throw new Error('PA_JARVIS_IDENTITY_SECRET is not configured with sufficient entropy.');
  return value;
}

const nonceConsumer: NonceConsumer = {
  async consume(nonce, expiresAt) {
    const updated = await prisma.paIdentityNonce.updateMany({
      where: { nonce, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (updated.count === 1) return true;
    try {
      await prisma.paIdentityNonce.create({ data: { nonce, expiresAt, consumedAt: new Date() } });
      return true;
    } catch {
      return false;
    }
  },
};

export async function verifyPAHandshake(token: string) {
  return verifyPAIdentityProof(token, requirePAIdentitySecret(), nonceConsumer);
}

export async function createPADelegation(input: {
  ownerUserId: string;
  delegationId?: string;
  objective: string;
  capabilities: PADelegationCapability[];
  traceId?: string;
}) {
  const allowed = new Set(PA_DELEGATION_CAPABILITIES);
  if (!input.objective.trim()) throw new Error('Delegation objective is required.');
  if (input.capabilities.length === 0 || input.capabilities.some((item) => !allowed.has(item))) {
    throw new Error('Delegation capability is outside the PA allowlist.');
  }

  return prisma.$transaction(async (tx) => {
    if (input.delegationId) {
      const existing = await tx.paDelegation.findFirst({
        where: { id: input.delegationId, ownerUserId: input.ownerUserId },
        include: { agentRun: true, receipt: true },
      });
      if (existing) {
        const existingCapabilities = Array.isArray(existing.requestedCapabilities)
          ? existing.requestedCapabilities.map(String).sort()
          : [];
        const requestedCapabilities = [...input.capabilities].map(String).sort();
        if (existing.objective !== input.objective.trim() || JSON.stringify(existingCapabilities) !== JSON.stringify(requestedCapabilities)) {
          throw new Error('Delegation idempotency conflict: the existing delegation does not match the requested objective or capabilities.');
        }
        if (!existing.agentRun) throw new Error('Delegation exists without its agent run; recovery is required before retry.');
        return { delegation: existing, run: existing.agentRun };
      }
    }

    const delegation = await tx.paDelegation.create({
      data: {
        id: input.delegationId || randomUUID(),
        ownerUserId: input.ownerUserId,
        objective: input.objective.trim(),
        requestedCapabilities: input.capabilities,
        status: 'pending_approval',
        traceId: input.traceId || randomUUID(),
      },
    });
    const run = await tx.agentRun.create({
      data: {
        userId: input.ownerUserId,
        objective: input.objective.trim(),
        executionScope: { paDelegationId: delegation.id, capabilities: input.capabilities },
        traceContext: captureQueueTraceContextForStorage(),
        status: 'queued',
        approvalStatus: 'pending',
      },
    });
    await tx.paDelegation.update({ where: { id: delegation.id }, data: { agentRunId: run.id } });
    await tx.agentHandoff.createMany({ data: [
      { runId: run.id, fromAgent: 'alex', toAgent: 'jarvis', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'jarvis', toAgent: 'primary', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'jarvis', toAgent: 'secondary', input: input.objective.trim(), status: 'pending' },
      { runId: run.id, fromAgent: 'primary', toAgent: 'logic', input: 'Awaiting primary analysis', status: 'pending' },
      { runId: run.id, fromAgent: 'secondary', toAgent: 'logic', input: 'Awaiting secondary analysis', status: 'pending' },
      { runId: run.id, fromAgent: 'jarvis', toAgent: 'alex', input: 'Awaiting Jarvis synthesis and execution receipt', status: 'pending' },
    ] });
    await tx.jarvisAuditEvent.create({
      data: { actorId: 'ryanai-pa', eventType: 'pa.delegation.created', resourceId: delegation.id, details: { ownerUserId: input.ownerUserId, agentRunId: run.id, capabilities: input.capabilities } },
    });
    await appendRunEvidence(tx, {
      runId: run.id,
      eventType: 'pa.delegation.created',
      actorId: 'ryanai-pa',
      payload: { delegationId: delegation.id, capabilities: input.capabilities, traceId: delegation.traceId },
    });
    return { delegation, run };
  });
}

export async function createJarvisIdentityProof(ownerUserId: string, delegationId: string) {
  const now = Math.floor(Date.now() / 1000);
  return signAgentIdentityProof({
    version: 1,
    issuer: JARVIS_IDENTITY,
    subject: JARVIS_IDENTITY,
    audience: 'ryanai-pa',
    ownerUserId,
    delegationId,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + 60,
    capabilities: [...PA_DELEGATION_CAPABILITIES],
  }, requirePAIdentitySecret());
}

export async function persistPAExecutionReceipt(input: { delegationId: string; agentRunId: string; traceId: string; attempt: number; status: string; result?: unknown; error?: string }) {
  return prisma.paExecutionReceipt.upsert({
    where: { delegationId: input.delegationId },
    create: {
      delegationId: input.delegationId,
      agentRunId: input.agentRunId,
      traceId: input.traceId,
      attempt: input.attempt,
      status: input.status,
      result: input.result as object | undefined,
      error: input.error,
    },
    update: {
      agentRunId: input.agentRunId,
      traceId: input.traceId,
      attempt: input.attempt,
      status: input.status,
      result: input.result as object | undefined,
      error: input.error,
    },
  });
}

export async function listPADelegations(ownerUserId: string) {
  return prisma.paDelegation.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      receipt: true,
      agentRun: {
        select: {
          id: true, status: true, approvalStatus: true, attempts: true, result: true, error: true,
          createdAt: true, completedAt: true,
          handoffs: { orderBy: { startedAt: 'asc' } },
        },
      },
    },
  });
}

export async function approvePADelegation(
  ownerUserId: string,
  delegationId: string,
  approvedBy: string,
  policyDecisions: Array<{ capability: string; decision: string; ruleId: string }>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const delegation = await tx.paDelegation.findFirst({
      where: { id: delegationId, ownerUserId },
      include: { agentRun: true },
    });
    if (!delegation?.agentRun) return null;
    const run = delegation.agentRun;
    if (run.approvalStatus === 'approved') {
      return { delegationId, runId: run.id, status: run.status, alreadyApproved: true };
    }
    if (run.approvalStatus !== 'pending' || run.status !== 'queued') {
      throw new Error('This PA delegation is no longer awaiting approval.');
    }
    const approvalUpdate = await tx.agentRun.updateMany({
      where: { id: run.id, approvalStatus: 'pending', status: 'queued' },
      data: { approvalStatus: 'approved', approvedBy, approvedAt: new Date(), status: 'queued' },
    });
    if (approvalUpdate.count !== 1) {
      const latestRun = await tx.agentRun.findUnique({
        where: { id: run.id },
        select: { approvalStatus: true },
      });
      const transition = resolvePAApprovalTransition(approvalUpdate.count, latestRun?.approvalStatus ?? null);
      if (transition === 'already_approved') {
        return { delegationId, runId: run.id, status: run.status, alreadyApproved: true };
      }
      throw new Error('This PA delegation changed while approval was being recorded; reload before retrying.');
    }
    await tx.paDelegation.update({ where: { id: delegation.id }, data: { status: 'approved' } });
    await appendRunEvidence(tx, {
      runId: run.id,
      eventType: 'pa.delegation.approved',
      actorId: approvedBy,
      payload: { delegationId, approvedBy, capabilities: delegation.requestedCapabilities, policyDecisions },
    });
    await tx.jarvisAuditEvent.create({
      data: { actorId: approvedBy, eventType: 'pa.delegation.approved', resourceId: delegationId, details: { ownerUserId, agentRunId: run.id, policyDecisions } },
    });
    return { delegationId, runId: run.id, status: 'queued', alreadyApproved: false };
  });
  if (!result || result.alreadyApproved) return result;
  const notified = await publishAgentTaskNotification(result.runId, async (id) => {
    await prisma.$queryRaw`SELECT pg_notify('agent_task_queue', ${id})`;
  });
  const notification: 'sent' | 'recovery_sweep' = notified ? 'sent' : 'recovery_sweep';
  return { ...result, notification };
}

export async function rejectPADelegation(ownerUserId: string, delegationId: string, rejectedBy: string) {
  return prisma.$transaction(async (tx) => {
    const delegation = await tx.paDelegation.findFirst({
      where: { id: delegationId, ownerUserId },
      include: { agentRun: true },
    });
    if (!delegation?.agentRun || delegation.agentRun.approvalStatus !== 'pending' || delegation.agentRun.status !== 'queued') return false;
    const now = new Date();
    await tx.agentRun.update({
      where: { id: delegation.agentRun.id },
      data: { approvalStatus: 'rejected', status: 'cancelled', error: 'Rejected by the authenticated owner.', completedAt: now },
    });
    await tx.paDelegation.update({ where: { id: delegation.id }, data: { status: 'rejected' } });
    await appendRunEvidence(tx, {
      runId: delegation.agentRun.id,
      eventType: 'pa.delegation.rejected',
      actorId: rejectedBy,
      payload: { delegationId, rejectedBy },
    });
    await tx.jarvisAuditEvent.create({
      data: { actorId: rejectedBy, eventType: 'pa.delegation.rejected', resourceId: delegationId, details: { ownerUserId, agentRunId: delegation.agentRun.id } },
    });
    return true;
  });
}

export async function getPADelegation(ownerUserId: string, delegationId: string) {
  return prisma.paDelegation.findFirst({
    where: { id: delegationId, ownerUserId },
    include: {
      receipt: true,
      agentRun: {
        select: { id: true, status: true, approvalStatus: true, attempts: true, result: true, error: true, createdAt: true, completedAt: true, handoffs: { orderBy: { startedAt: 'asc' } } },
      },
    },
  });
}
