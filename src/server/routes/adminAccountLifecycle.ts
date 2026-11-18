import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { requireOwner } from './auth.js';

type LifecycleAction = 'role_change' | 'suspend_account' | 'revoke_sessions';
type LifecycleRole = 'user' | 'admin';

interface CreateRequestBody {
  action: LifecycleAction;
  targetUserId: string;
  requestedRole?: LifecycleRole;
  reason: string;
  confirmation: string;
}

interface ConfirmRequestBody {
  confirmation: string;
}

interface LifecycleEventDetails {
  requestId?: string;
  action?: LifecycleAction;
  targetUserId?: string;
  requestedRole?: LifecycleRole;
  reason?: string;
  state?: string;
  policyDecision?: string;
  policyRuleId?: string;
  capabilityNote?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<LifecycleAction>(['role_change', 'suspend_account', 'revoke_sessions']);

function detailsOf(value: unknown): LifecycleEventDetails {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LifecycleEventDetails
    : {};
}

function policyFor(actorId: string, targetUserId: string, action: 'CREATE' | 'UPDATE') {
  return evaluateGenXSecurityEvent({
    agentId: 'ryanai-admin-console',
    principal: actorId,
    toolName: 'ryanai_account_lifecycle',
    action,
    target: 'auth.users/' + targetUserId,
    actorType: 'human',
    ownerAuthorized: true,
    ownerConfirmed: true,
  });
}

/**
 * Owner-only, two-step account lifecycle request ledger.
 *
 * This API records owner requests and explicit confirmations only. It does not
 * call Supabase Auth mutation endpoints. A separately reviewed executor must
 * be added after staging validation and a production-operation approval.
 */
export const adminAccountLifecycleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireOwner);

  fastify.get('/api/admin/account-lifecycle/requests', async () => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { in: ['ACCOUNT_LIFECYCLE_REQUESTED', 'ACCOUNT_LIFECYCLE_CONFIRMED'] } },
      take: 500,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, actorId: true, eventType: true, resourceId: true, details: true, createdAt: true },
    });
    const latest = new Map<string, { id: string; actorId: string; eventType: string; resourceId: string | null; details: LifecycleEventDetails; createdAt: Date }>();
    for (const event of events) {
      const details = detailsOf(event.details);
      if (details.requestId && !latest.has(details.requestId)) {
        latest.set(details.requestId, { ...event, details });
      }
    }
    return {
      requests: [...latest.values()].map((event) => ({
        id: event.details.requestId,
        action: event.details.action,
        targetUserId: event.details.targetUserId,
        requestedRole: event.details.requestedRole ?? null,
        reason: event.details.reason,
        state: event.details.state,
        policyDecision: event.details.policyDecision,
        policyRuleId: event.details.policyRuleId,
        capabilityNote: event.details.capabilityNote ?? null,
        actorId: event.actorId,
        createdAt: event.createdAt,
      })),
      ledger: 'append-only jarvis_audit_events',
    };
  });

  fastify.post<{ Body: CreateRequestBody }>('/api/admin/account-lifecycle/requests', async (request, reply) => {
    const body = request.body ?? {} as CreateRequestBody;
    const action = body.action;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!ACTIONS.has(action)) return reply.code(400).send({ error: 'Unsupported account lifecycle action.' });
    if (!UUID_PATTERN.test(targetUserId)) return reply.code(400).send({ error: 'targetUserId must be a valid UUID.' });
    if (targetUserId === request.authUser?.id) return reply.code(400).send({ error: 'Owner self-lockout actions are prohibited.' });
    if (reason.length < 10) return reply.code(400).send({ error: 'Provide a reason of at least 10 characters.' });
    if (action === 'role_change' && !['user', 'admin'].includes(body.requestedRole ?? '')) {
      return reply.code(400).send({ error: 'Role changes may set only user or admin; owner elevation is prohibited.' });
    }
    if (action !== 'role_change' && body.requestedRole !== undefined) {
      return reply.code(400).send({ error: 'requestedRole is valid only for role_change requests.' });
    }
    const expectedPhrase = 'REQUEST ' + action.toUpperCase() + ' ' + targetUserId;
    if (body.confirmation !== expectedPhrase) {
      return reply.code(400).send({ error: 'Explicit confirmation phrase does not match the requested action and target.' });
    }

    const policy = policyFor(request.authUser!.id, targetUserId, 'CREATE');
    if (policy.decision !== 'ALLOW') {
      return reply.code(403).send({ error: 'Gen-X blocked this lifecycle request.', policy: { decision: policy.decision, ruleId: policy.ruleId } });
    }

    const requestId = randomUUID();
    const capabilityNote = action === 'revoke_sessions'
      ? 'Execution is not enabled: Supabase session revocation requires the target user JWT. The platform will not collect or store another user’s JWT.'
      : 'Request is owner-confirmed and recorded. No Auth role or ban state is changed by this endpoint.';
    const details: LifecycleEventDetails = {
      requestId,
      action,
      targetUserId,
      requestedRole: body.requestedRole,
      reason,
      state: action === 'revoke_sessions' ? 'CONFIRMED_CAPABILITY_BLOCKED' : 'CONFIRMED_PENDING_EXECUTION_REVIEW',
      policyDecision: policy.decision,
      policyRuleId: policy.ruleId,
      capabilityNote,
    };
    await fastify.prisma.jarvisAuditEvent.create({
      data: {
        actorId: request.authUser!.id,
        eventType: 'ACCOUNT_LIFECYCLE_REQUESTED',
        resourceId: targetUserId,
        details,
      },
    });
    return reply.code(201).send({
      requestId,
      state: details.state,
      action,
      targetUserId,
      requestedRole: body.requestedRole ?? null,
      policy: { decision: policy.decision, ruleId: policy.ruleId },
      capabilityNote,
      confirmationRecorded: true,
      accountMutationPerformed: false,
    });
  });

  fastify.post<{ Params: { requestId: string }; Body: ConfirmRequestBody }>(
    '/api/admin/account-lifecycle/requests/:requestId/confirm',
    async (request, reply) => {
      const requestId = request.params.requestId;
      if (!UUID_PATTERN.test(requestId)) return reply.code(400).send({ error: 'requestId must be a valid UUID.' });
      if (request.body?.confirmation !== 'CONFIRM ' + requestId) {
        return reply.code(400).send({ error: 'Explicit confirmation phrase does not match this request ID.' });
      }

      const events = await fastify.prisma.jarvisAuditEvent.findMany({
        where: { eventType: { in: ['ACCOUNT_LIFECYCLE_REQUESTED', 'ACCOUNT_LIFECYCLE_CONFIRMED'] } },
        take: 500,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { actorId: true, eventType: true, details: true },
      });
      const prior = events.find((event) => detailsOf(event.details).requestId === requestId);
      if (!prior || prior.eventType !== 'ACCOUNT_LIFECYCLE_REQUESTED') {
        return reply.code(404).send({ error: 'A pending lifecycle request was not found.' });
      }
      const details = detailsOf(prior.details);
      if (!details.targetUserId || !UUID_PATTERN.test(details.targetUserId) || !details.action) {
        return reply.code(409).send({ error: 'The stored lifecycle request is incomplete and cannot be confirmed.' });
      }
      const policy = policyFor(request.authUser!.id, details.targetUserId, 'UPDATE');
      if (policy.decision !== 'ALLOW') {
        return reply.code(403).send({ error: 'Gen-X blocked lifecycle confirmation.', policy: { decision: policy.decision, ruleId: policy.ruleId } });
      }
      const capabilityNote = details.action === 'revoke_sessions'
        ? 'Session revocation remains blocked until a secure, verified target-session token flow exists.'
        : 'Owner confirmation is recorded; execution remains disabled pending separate staging verification and production authorization.';
      const confirmed: LifecycleEventDetails = {
        ...details,
        state: details.action === 'revoke_sessions' ? 'CONFIRMED_CAPABILITY_BLOCKED' : 'CONFIRMED_PENDING_EXECUTION_REVIEW',
        policyDecision: policy.decision,
        policyRuleId: policy.ruleId,
        capabilityNote,
      };
      await fastify.prisma.jarvisAuditEvent.create({
        data: {
          actorId: request.authUser!.id,
          eventType: 'ACCOUNT_LIFECYCLE_CONFIRMED',
          resourceId: details.targetUserId,
          details: confirmed,
        },
      });
      return {
        requestId,
        state: confirmed.state,
        policy: { decision: policy.decision, ruleId: policy.ruleId },
        confirmationRecorded: true,
        accountMutationPerformed: false,
        capabilityNote,
      };
    },
  );
};
