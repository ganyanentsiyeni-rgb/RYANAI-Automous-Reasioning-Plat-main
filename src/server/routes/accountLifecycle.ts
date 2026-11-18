import type { FastifyPluginAsync } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { requireOwner } from './auth.js';

const REQUEST_TYPES = ['role_change', 'account_suspension', 'session_revocation'] as const;
const CONFIRMATION = 'I CONFIRM THIS ACCOUNT LIFECYCLE REQUEST';

interface RequestBody {
  requestType?: string;
  targetUserId?: string;
  requestedRole?: string;
  reason?: string;
  confirmed?: boolean;
}

export const accountLifecycleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireOwner);

  fastify.get('/api/admin/account-lifecycle-requests', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    const requests = await fastify.prisma.accountLifecycleRequest.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, requestType: true, targetUserId: true, requestedRole: true,
        reason: true, status: true, policyRuleId: true, policyDecision: true,
        createdBy: true, createdAt: true,
      },
    });
    return { requests, execution: 'disabled_pending_separate_implementation_and_approval' };
  });

  fastify.post<{ Body: RequestBody }>('/api/admin/account-lifecycle-requests', async (request, reply) => {
    const owner = request.authUser;
    if (!owner?.id || !owner.isOwner) return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
    const body = request.body ?? {};
    const requestType = body.requestType;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';

    if (!REQUEST_TYPES.includes(requestType as typeof REQUEST_TYPES[number])) {
      return reply.code(400).send({ error: 'requestType must be role_change, account_suspension, or session_revocation.' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return reply.code(400).send({ error: 'A valid targetUserId is required.' });
    }
    if (!reason || body.confirmed !== true) {
      return reply.code(400).send({ error: 'A reason and explicit owner confirmation are required.' });
    }
    if (requestType === 'role_change' && !['user', 'admin'].includes(body.requestedRole ?? '')) {
      return reply.code(400).send({ error: 'Role changes must request either user or admin.' });
    }
    if (requestType !== 'role_change' && body.requestedRole !== undefined) {
      return reply.code(400).send({ error: 'requestedRole is valid only for role_change requests.' });
    }

    const policy = evaluateGenXSecurityEvent({
      agentId: 'ryanai-owner-console',
      principal: owner.id,
      toolName: 'owner_account_lifecycle_request',
      action: 'UPDATE',
      target: 'account-lifecycle-request',
      environment: process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'staging' ? 'staging' : 'development',
      actorType: 'human',
    });
    if (policy.decision === 'DENY') {
      return reply.code(403).send({ error: 'Gen-X denied this account lifecycle request.', ruleId: policy.ruleId });
    }

    const created = await fastify.prisma.$transaction(async (tx) => {
      const record = await tx.accountLifecycleRequest.create({
        data: {
          requestType,
          targetUserId,
          requestedRole: requestType === 'role_change' ? body.requestedRole : null,
          reason,
          status: 'pending',
          policyDecision: policy.decision,
          policyRuleId: policy.ruleId,
          createdBy: owner.id,
          confirmedAt: new Date(),
        },
        select: { id: true, requestType: true, targetUserId: true, requestedRole: true, status: true, policyDecision: true, policyRuleId: true, createdAt: true },
      });
      await tx.accountLifecycleAuditEvent.create({
        data: {
          requestId: record.id,
          actorId: owner.id,
          eventType: 'account.lifecycle.requested',
          details: {
            requestType,
            targetUserId,
            requestedRole: requestType === 'role_change' ? body.requestedRole : null,
            policyDecision: policy.decision,
            policyRuleId: policy.ruleId,
            ownerConfirmed: true,
          },
        },
      });
      return record;
    });

    return reply.code(201).send({
      request: created,
      message: 'Request recorded. No role, account status, or session has been changed.',
      execution: 'disabled_pending_separate_implementation_and_approval',
    });
  });
};
