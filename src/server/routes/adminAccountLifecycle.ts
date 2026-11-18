import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { createAuditIntegrity, verifyAuditIntegrity, type AuditIntegrityRecord } from '../security/auditIntegrity.js';
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
  integrity?: { version: 1; previousHash: string; eventHash: string };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<LifecycleAction>(['role_change', 'suspend_account', 'revoke_sessions']);
const LIFECYCLE_EVENT_TYPES = ['ACCOUNT_LIFECYCLE_REQUESTED', 'ACCOUNT_LIFECYCLE_CONFIRMED'];
const LIFECYCLE_CHAIN_LOCK = 'ryanai-account-lifecycle-audit-integrity-chain';
const MAX_INTEGRITY_EVENTS = 10000;

function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  // Prisma's JSON input type excludes undefined values; JSON round-tripping
  // removes optional undefined fields while preserving the stored audit payload.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

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
    ownerConfirmed: action === 'UPDATE',
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

  fastify.get('/api/admin/account-lifecycle/audit-integrity', async (_request, reply) => {
    const events = await fastify.prisma.jarvisAuditEvent.findMany({
      where: { eventType: { in: LIFECYCLE_EVENT_TYPES } },
      take: MAX_INTEGRITY_EVENTS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, actorId: true, eventType: true, resourceId: true, details: true },
    });
    const truncated = events.length === MAX_INTEGRITY_EVENTS;
    const verification = verifyAuditIntegrity(events as AuditIntegrityRecord[]);
    const integrityStatus = truncated ? 'INCOMPLETE'
      : !verification.valid ? 'INVALID'
      : verification.checked === 0 ? 'LEGACY_UNVERIFIED'
      : verification.legacyUnverified > 0 ? 'VALID_WITH_LEGACY_PREFIX' : 'VALID';
    return reply.send({
      integrityStatus,
      verified: !truncated && verification.valid && verification.checked > 0,
      checked: verification.checked,
      legacyUnverified: verification.legacyUnverified,
      firstInvalidEventId: verification.firstInvalidEventId,
      headHash: verification.headHash,
      scanned: events.length,
      scanLimit: MAX_INTEGRITY_EVENTS,
      truncated,
      trustBoundary: 'Database-resident hash links detect payload and chain edits but cannot prove integrity against a privileged database writer who can rewrite and recompute the entire chain. A separately held signed checkpoint is required for that threat model.',
    });
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
    const policy = policyFor(request.authUser!.id, targetUserId, 'CREATE');
    if (policy.decision !== 'ALLOW') {
      return reply.code(403).send({ error: 'Gen-X blocked this lifecycle request.', policy: { decision: policy.decision, ruleId: policy.ruleId } });
    }

    const requestId = randomUUID();
    const capabilityNote = action === 'revoke_sessions'
      ? 'Pending owner confirmation. Session revocation later requires the target user JWT; the platform will not collect or store another user’s JWT.'
      : 'Pending owner confirmation. No Auth role or ban state is changed by this endpoint.';
    const details: LifecycleEventDetails = {
      requestId,
      action,
      targetUserId,
      ...(body.requestedRole ? { requestedRole: body.requestedRole } : {}),
      reason,
      state: 'PENDING_OWNER_CONFIRMATION',
      policyDecision: policy.decision,
      policyRuleId: policy.ruleId,
      capabilityNote,
    };
    const eventId = randomUUID();
    const appendResult = await fastify.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', LIFECYCLE_CHAIN_LOCK);
      const history = await tx.jarvisAuditEvent.findMany({
        where: { eventType: { in: LIFECYCLE_EVENT_TYPES } },
        take: MAX_INTEGRITY_EVENTS,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, actorId: true, eventType: true, resourceId: true, details: true },
      });
      if (history.length === MAX_INTEGRITY_EVENTS) throw new Error('Lifecycle audit integrity scan limit reached; refusing to append.');
      const verification = verifyAuditIntegrity(history as AuditIntegrityRecord[]);
      if (!verification.valid) throw new Error('Lifecycle audit integrity verification failed; refusing to append.');
      const integrity = createAuditIntegrity({
        id: eventId, actorId: request.authUser!.id, eventType: 'ACCOUNT_LIFECYCLE_REQUESTED',
        resourceId: targetUserId, details,
      }, verification.headHash);
      await tx.jarvisAuditEvent.create({
        data: { id: eventId, actorId: request.authUser!.id, eventType: 'ACCOUNT_LIFECYCLE_REQUESTED',
          resourceId: targetUserId, details: toPrismaJsonObject({ ...details, integrity }) },
      });
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('Lifecycle audit integrity')) return null;
      throw error;
    });
    if (!appendResult) {
      return reply.code(409).send({ error: 'Lifecycle audit integrity could not be verified; request was not recorded.' });
    }
    return reply.code(201).send({
      requestId,
      state: details.state,
      action,
      targetUserId,
      requestedRole: body.requestedRole ?? null,
      policy: { decision: policy.decision, ruleId: policy.ruleId },
      capabilityNote,
      confirmationRecorded: false,
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

      // Serialize confirmations per request across API instances. The lock is
      // transaction-scoped, so the audit lookup and append are one atomic decision.
      const outcome = await fastify.prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          'ryanai-account-lifecycle-confirm:' + requestId,
        );
        const events = await tx.jarvisAuditEvent.findMany({
          where: { eventType: { in: ['ACCOUNT_LIFECYCLE_REQUESTED', 'ACCOUNT_LIFECYCLE_CONFIRMED'] } },
          take: 500,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { actorId: true, eventType: true, details: true },
        });
        const prior = events.find((event) => detailsOf(event.details).requestId === requestId);
        if (!prior || prior.eventType !== 'ACCOUNT_LIFECYCLE_REQUESTED') {
          return { statusCode: 409 as const, body: { error: 'This lifecycle request has already been confirmed or is no longer pending.' } };
        }
        const details = detailsOf(prior.details);
        if (!details.targetUserId || !UUID_PATTERN.test(details.targetUserId) || !details.action) {
          return { statusCode: 409 as const, body: { error: 'The stored lifecycle request is incomplete and cannot be confirmed.' } };
        }
        const policy = policyFor(request.authUser!.id, details.targetUserId, 'UPDATE');
        if (policy.decision !== 'ALLOW') {
          return { statusCode: 403 as const, body: { error: 'Gen-X blocked lifecycle confirmation.', policy: { decision: policy.decision, ruleId: policy.ruleId } } };
        }
        const capabilityNote = details.action === 'revoke_sessions'
          ? 'Session revocation remains blocked until a secure, verified target-session token flow exists.'
          : 'Owner confirmation is recorded; execution remains disabled pending separate staging verification and production authorization.';
        const confirmed: LifecycleEventDetails = {
          ...details,
          state: details.action === 'revoke_sessions' ? 'CONFIRMED_CAPABILITY_BLOCKED' : 'OWNER_CONFIRMED_PENDING_EXECUTION_REVIEW',
          policyDecision: policy.decision,
          policyRuleId: policy.ruleId,
          capabilityNote,
        };
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', LIFECYCLE_CHAIN_LOCK);
        const history = await tx.jarvisAuditEvent.findMany({
          where: { eventType: { in: LIFECYCLE_EVENT_TYPES } },
          take: MAX_INTEGRITY_EVENTS,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, actorId: true, eventType: true, resourceId: true, details: true },
        });
        if (history.length === MAX_INTEGRITY_EVENTS) {
          return { statusCode: 409 as const, body: { error: 'Lifecycle audit integrity scan limit reached; confirmation was not recorded.' } };
        }
        const verification = verifyAuditIntegrity(history as AuditIntegrityRecord[]);
        if (!verification.valid) {
          return { statusCode: 409 as const, body: { error: 'Lifecycle audit integrity verification failed; confirmation was not recorded.' } };
        }
        const eventId = randomUUID();
        const integrity = createAuditIntegrity({
          id: eventId, actorId: request.authUser!.id, eventType: 'ACCOUNT_LIFECYCLE_CONFIRMED',
          resourceId: details.targetUserId, details: confirmed,
        }, verification.headHash);
        await tx.jarvisAuditEvent.create({
          data: { id: eventId, actorId: request.authUser!.id, eventType: 'ACCOUNT_LIFECYCLE_CONFIRMED',
            resourceId: details.targetUserId, details: toPrismaJsonObject({ ...confirmed, integrity }) },
        });
        return {
          statusCode: 200 as const,
          body: {
            requestId,
            state: confirmed.state,
            policy: { decision: policy.decision, ruleId: policy.ruleId },
            confirmationRecorded: true,
            accountMutationPerformed: false,
            capabilityNote,
          },
        };
      });
      return reply.code(outcome.statusCode).send(outcome.body);
    },
  );
};
