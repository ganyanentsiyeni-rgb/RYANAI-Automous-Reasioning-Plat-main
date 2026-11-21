import { createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { isCommunicationsEnabled, isCommunicationsTestAuthorized } from './featureFlags.js';
import { addressOwnerMessage } from './personalization.js';

export type CommsChannel = 'whatsapp' | 'sms' | 'voice' | 'email';
export type DestinationChannel = 'phone' | 'email';

export interface CommsActionPayload {
  channel: CommsChannel;
  recipient: string;
  body: string;
  subject: string;
  contentSid: string | null;
  contentVariables: string | null;
  idempotencyKey: string;
  attachmentIds: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function normalizeCommsRecipient(channel: CommsChannel | DestinationChannel, value: string): string {
  const trimmed = value.trim();
  if (String(channel) === 'email') return trimmed.toLowerCase();
  return trimmed.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}

export function buildCommsActionPayload(input: CommsActionPayload): CommsActionPayload {
  return {
    ...input,
    recipient: normalizeCommsRecipient(input.channel, input.recipient),
    attachmentIds: [...input.attachmentIds],
  };
}

export function hashCommsActionPayload(payload: CommsActionPayload): string {
  return createHash('sha256').update(canonical(buildCommsActionPayload(payload))).digest('hex');
}

function genXDecision(ownerUserId: string, payloadHash: string, channel: CommsChannel) {
  return evaluateGenXSecurityEvent({
    agentId: 'ryanai-api',
    principal: ownerUserId,
    toolName: 'api_comms_send',
    action: 'NETWORK',
    target: `comms:${channel}:${payloadHash}`,
    actorType: 'human',
  });
}

/**
 * Resolve one pending outbound action only after an authenticated owner reply
 * arrives through the signed Twilio webhook. The decision is bound to the
 * stored payload digest, owner identity, expiry and current Gen-X policy.
 */
export async function decideCommsApprovalFromOwner(
  prisma: {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
    $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  },
  ownerUserId: string,
  approvalId: string,
  decision: 'approve' | 'reject',
): Promise<{ approvalId: string; status: 'approved' | 'rejected' }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalId)) {
    throw new Error('invalid_approval_id');
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ channel: CommsChannel; payload_hash: string }>>(
    `SELECT channel, payload_hash FROM public.comms_send_approvals
      WHERE id = $1::uuid AND owner_user_id = $2 AND status = 'pending' AND expires_at > NOW()
      LIMIT 1`,
    approvalId, ownerUserId,
  );
  const action = rows[0];
  if (!action) throw new Error('approval_not_found_or_expired');
  const policy = genXDecision(ownerUserId, action.payload_hash, action.channel);
  if (policy.decision === 'DENY') throw new Error('genx_denied');
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE public.comms_send_approvals
        SET status = $3, approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE NULL END,
            policy_rule_id = $4, updated_at = NOW()
      WHERE id = $1::uuid AND owner_user_id = $2
        AND status = 'pending' AND expires_at > NOW()`,
    approvalId, ownerUserId, status, policy.ruleId,
  );
  if (updated !== 1) throw new Error('approval_already_decided_or_expired');
  return { approvalId, status };
}

async function verifiedDestination(
  prisma: { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> },
  ownerUserId: string,
  channel: CommsChannel,
  recipient: string,
): Promise<boolean> {
  const destinationChannel: DestinationChannel = String(channel) === 'email' ? 'email' : 'phone';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM public.comms_verified_destinations
     WHERE owner_user_id = $1 AND channel = $2 AND normalized_address = $3
       AND revoked_at IS NULL AND verified_at <= NOW()
     LIMIT 1`,
    ownerUserId, destinationChannel, normalizeCommsRecipient(destinationChannel, recipient),
  );
  return rows.length === 1;
}

export async function assertCommsActionAuthorized(
  prisma: {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  },
  ownerUserId: string,
  approvalId: string,
  payload: CommsActionPayload,
): Promise<void> {
  const normalized = buildCommsActionPayload(payload);
  const payloadHash = hashCommsActionPayload(normalized);
  const policy = genXDecision(ownerUserId, payloadHash, normalized.channel);
  if (policy.decision === 'DENY') throw new Error('Gen-X denied this communications action.');
  if (!(await verifiedDestination(prisma, ownerUserId, normalized.channel, normalized.recipient))) {
    throw new Error('The recipient is not a verified owner destination.');
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string }>>(
    `SELECT id, status FROM public.comms_send_approvals
     WHERE id = $1::uuid AND owner_user_id = $2 AND payload_hash = $3
       AND expires_at > NOW()
       AND status IN ('approved', 'dispatching', 'accepted', 'unknown')
     LIMIT 1`,
    approvalId, ownerUserId, payloadHash,
  );
  if (rows.length !== 1) throw new Error('A current owner approval for this exact communications action is required.');
}

export async function claimCommsAction(
  prisma: {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  },
  ownerUserId: string,
  approvalId: string,
  payload: CommsActionPayload,
): Promise<void> {
  const normalized = buildCommsActionPayload(payload);
  const payloadHash = hashCommsActionPayload(normalized);
  const policy = genXDecision(ownerUserId, payloadHash, normalized.channel);
  if (policy.decision === 'DENY') throw new Error('Gen-X denied this communications action.');
  if (!(await verifiedDestination(prisma, ownerUserId, normalized.channel, normalized.recipient))) {
    throw new Error('The recipient is not a verified owner destination.');
  }
  const claimed = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE public.comms_send_approvals
       SET status = 'dispatching', dispatched_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid AND owner_user_id = $2 AND payload_hash = $3
       AND status = 'approved' AND expires_at > NOW()
     RETURNING id`,
    approvalId, ownerUserId, payloadHash,
  );
  if (claimed.length !== 1) throw new Error('The approved communications action is expired, changed, or already claimed.');
}

export async function finishCommsAction(
  prisma: { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> },
  approvalId: string,
  outcome: { status: 'accepted' | 'unknown' | 'failed'; providerMessageId?: string | null; providerStatus?: string | null },
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE public.comms_send_approvals
       SET status = $2, provider_message_id = $3, provider_status = $4, updated_at = NOW()
     WHERE id = $1::uuid AND status = 'dispatching'`,
    approvalId, outcome.status, outcome.providerMessageId ?? null, outcome.providerStatus ?? null,
  );
}

function validChannel(value: unknown): value is CommsChannel {
  return value === 'whatsapp' || value === 'sms' || value === 'voice' || value === 'email';
}

function validRecipient(channel: DestinationChannel, recipient: string): boolean {
  return String(channel) === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    : /^\+[1-9]\d{7,14}$/.test(recipient);
}

type AuthorizationBody = {
  channel?: CommsChannel;
  recipient?: string;
  message?: string;
  subject?: string;
  contentSid?: string;
  contentVariables?: string;
  idempotencyKey?: string;
  attachmentIds?: string[];
};

export const commsAuthorizationRoutes: FastifyPluginAsync = async (fastify) => {
  // Keep destination management and approval/history UI routes registered even
  // while outbound communications are disabled. Provider actions are gated per route.
  const ownerId = (request: { authUser?: { id: string; isOwner?: boolean } | null }) =>
    request.authUser?.isOwner ? request.authUser.id : null;

  fastify.post<{ Body: { channel?: DestinationChannel; recipient?: string } }>(
    '/api/comms/destinations/verification/start',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const userId = ownerId(request);
      if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
      if (!isCommunicationsEnabled() || !isCommunicationsTestAuthorized()) {
        return reply.code(503).send({ error: 'Destination verification is unavailable until communications are enabled and an owner-authorized provider test is active.' });
      }
      const channel = request.body?.channel;
      const rawRecipient = typeof request.body?.recipient === 'string' ? request.body.recipient.trim() : '';
      if (channel !== 'phone' && channel !== 'email') return reply.code(400).send({ error: 'Choose phone or email verification.' });
      const recipient = normalizeCommsRecipient(channel, rawRecipient);
      if (!recipient || !validRecipient(channel, recipient)) return reply.code(400).send({ error: 'Enter a valid destination address.' });
      const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
      const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      if (!serviceSid || !accountSid || !authToken) return reply.code(503).send({ error: 'Twilio Verify is not configured. No verification message was sent.' });
      try {
        const verification = await twilio(accountSid, authToken).verify.v2.services(serviceSid).verifications.create({
          to: recipient,
          channel: channel === 'phone' ? 'sms' : 'email',
        });
        const challengeId = randomUUID();
        await fastify.prisma.$executeRawUnsafe(
          `INSERT INTO public.comms_destination_verification_challenges
            (id, owner_user_id, channel, address, normalized_address, provider_verification_sid, expires_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW() + INTERVAL '10 minutes')`,
          challengeId, userId, channel, recipient, recipient, verification.sid,
        );
        return reply.code(201).send({ challengeId, channel, expiresInSeconds: 600, providerStatus: verification.status });
      } catch (error) {
        request.log.warn({ err: error }, 'Communications destination verification could not be started');
        return reply.code(503).send({ error: 'Destination verification is unavailable. No destination was marked verified.' });
      }
    },
  );

  fastify.post<{ Body: { challengeId?: string; code?: string } }>(
    '/api/comms/destinations/verification/complete',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const userId = ownerId(request);
      if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
      const challengeId = typeof request.body?.challengeId === 'string' ? request.body.challengeId : '';
      const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{4,10}$/.test(code)) return reply.code(400).send({ error: 'A valid challenge ID and verification code are required.' });
      const challenges = await fastify.prisma.$queryRawUnsafe<Array<{ channel: DestinationChannel; address: string; normalized_address: string; provider_verification_sid: string }>>(
        `SELECT channel, address, normalized_address, provider_verification_sid
           FROM public.comms_destination_verification_challenges
          WHERE id = $1::uuid AND owner_user_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
          LIMIT 1`,
        challengeId, userId,
      );
      const challenge = challenges[0];
      if (!challenge) return reply.code(410).send({ error: 'Verification challenge expired or already used.' });
      const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
      const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      if (!serviceSid || !accountSid || !authToken) return reply.code(503).send({ error: 'Twilio Verify is not configured.' });
      try {
        const checked = await twilio(accountSid, authToken).verify.v2.services(serviceSid).verificationChecks.create({
          to: challenge.address,
          code,
        });
        if (checked.status !== 'approved') return reply.code(400).send({ error: 'The verification code was not accepted.' });
        await fastify.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.comms_verified_destinations
              (owner_user_id, channel, address, normalized_address, verified_at, revoked_at)
             VALUES ($1, $2, $3, $4, NOW(), NULL)
             ON CONFLICT (owner_user_id, channel, normalized_address)
             DO UPDATE SET address = EXCLUDED.address, verified_at = NOW(), revoked_at = NULL`,
            userId, challenge.channel, challenge.address, challenge.normalized_address,
          );
          await tx.$executeRawUnsafe(
            `UPDATE public.comms_destination_verification_challenges
                SET consumed_at = NOW()
              WHERE id = $1::uuid AND owner_user_id = $2 AND consumed_at IS NULL`,
            challengeId, userId,
          );
        });
        return { success: true, destination: { channel: challenge.channel, address: challenge.address, verified: true } };
      } catch (error) {
        request.log.warn({ err: error }, 'Communications destination verification failed');
        return reply.code(503).send({ error: 'Destination verification could not be completed.' });
      }
    },
  );

  fastify.get('/api/comms/destinations', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    const destinations = await fastify.prisma.$queryRawUnsafe<Array<{ id: string; channel: string; address: string; verified_at: Date }>>(
      `SELECT id, channel, address, verified_at FROM public.comms_verified_destinations
        WHERE owner_user_id = $1 AND revoked_at IS NULL ORDER BY verified_at DESC`,
      userId,
    );
    return { destinations: destinations.map(item => ({ id: item.id, channel: item.channel, address: item.address, verifiedAt: item.verified_at })) };
  });

  fastify.delete<{ Params: { id: string } }>('/api/comms/destinations/:id', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid destination ID.' });
    const updated = await fastify.prisma.$executeRawUnsafe(
      `UPDATE public.comms_verified_destinations SET revoked_at = NOW()
        WHERE id = $1::uuid AND owner_user_id = $2 AND revoked_at IS NULL`,
      request.params.id, userId,
    );
    if (updated !== 1) return reply.code(404).send({ error: 'Verified destination not found.' });
    return { destinationId: request.params.id, status: 'revoked' };
  });

  fastify.post<{ Body: AuthorizationBody }>('/api/comms/approvals', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    const body = request.body ?? {};
    const channel = body.channel;
    const recipient = typeof body.recipient === 'string' && body.recipient.trim()
      ? body.recipient.trim()
      : process.env.RYANAI_OWNER_PHONE?.trim() || '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (body.attachmentIds !== undefined && !Array.isArray(body.attachmentIds)) return reply.code(400).send({ error: 'Attachment IDs must be a list.' });
    const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
    if (!validChannel(channel)) return reply.code(400).send({ error: 'Unsupported communication channel.' });
    if (String(channel) === 'email') return reply.code(503).send({ error: 'Email approvals are disabled until a delivery-callback-capable provider is integrated. SMTP acceptance is not delivery confirmation.' });
    const normalizedRecipient = normalizeCommsRecipient(channel, recipient);
    const destinationChannel: DestinationChannel = 'phone';
    if (!validRecipient(destinationChannel, normalizedRecipient)) return reply.code(400).send({ error: 'Recipient address is invalid.' });
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey)) return reply.code(400).send({ error: 'A valid idempotency key is required.' });
    if ((!message && !(channel === 'whatsapp' && (body.contentSid || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim()))) || message.length > 4000) return reply.code(400).send({ error: 'A message of at most 4,000 characters is required.' });
    if (attachmentIds.length > 8 || attachmentIds.some(item => typeof item !== 'string') || new Set(attachmentIds).size !== attachmentIds.length) return reply.code(400).send({ error: 'At most 8 unique attachment IDs are supported.' });
    const verified = await verifiedDestination(fastify.prisma, userId, channel, normalizedRecipient);
    if (!verified) return reply.code(403).send({ error: 'Verify this destination before requesting a send approval.' });
    const ownerPhone = process.env.RYANAI_OWNER_PHONE?.trim();
    const isOwnerRecipient = Boolean(ownerPhone && normalizeCommsRecipient('sms', normalizedRecipient) === normalizeCommsRecipient('sms', ownerPhone));
    const deliveryBody = isOwnerRecipient && message ? addressOwnerMessage(message) : message;
    const payload = buildCommsActionPayload({
      channel,
      recipient: normalizedRecipient,
      body: deliveryBody || '[WhatsApp approved template]',
      subject: typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : 'RyanAI notification',
      contentSid: typeof body.contentSid === 'string' && body.contentSid.trim() ? body.contentSid.trim() : process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() || null,
      contentVariables: typeof body.contentVariables === 'string' ? body.contentVariables : null,
      idempotencyKey,
      attachmentIds: attachmentIds as string[],
    });
    const payloadHash = hashCommsActionPayload(payload);
    const policy = genXDecision(userId, payloadHash, channel);
    if (policy.decision === 'DENY') return reply.code(403).send({ error: 'Gen-X denied this communications action.', ruleId: policy.ruleId });
    const id = randomUUID();
    try {
      await fastify.prisma.$executeRawUnsafe(
        `INSERT INTO public.comms_send_approvals
          (id, owner_user_id, channel, recipient, payload_hash, payload, policy_rule_id, status, expires_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, 'pending', NOW() + INTERVAL '10 minutes')`,
        id, userId, channel, normalizedRecipient, payloadHash, JSON.stringify(payload), policy.ruleId,
      );
      return reply.code(201).send({ approvalId: id, status: 'pending', expiresInSeconds: 600, policy: { decision: policy.decision, ruleId: policy.ruleId } });
    } catch (error) {
      request.log.error({ err: error }, 'Communications approval request could not be stored');
      return reply.code(503).send({ error: 'The approval request could not be safely stored.' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/comms/approvals/:id', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid approval ID.' });
    const rows = await fastify.prisma.$queryRawUnsafe<Array<{ status: string; channel: string; recipient: string; expires_at: Date }>>(
      `SELECT status, channel, recipient, expires_at
         FROM public.comms_send_approvals
        WHERE id = $1::uuid AND owner_user_id = $2
        LIMIT 1`,
      request.params.id, userId,
    );
    const item = rows[0];
    if (!item) return reply.code(404).send({ error: 'Approval request not found.' });
    return { approvalId: request.params.id, status: item.status, channel: item.channel, recipient: item.recipient, expiresAt: item.expires_at.toISOString() };
  });

  fastify.post<{ Params: { id: string } }>('/api/comms/approvals/:id/approve', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid approval ID.' });
    const rows = await fastify.prisma.$queryRawUnsafe<Array<{ channel: CommsChannel; payload_hash: string }>>(
      `SELECT channel, payload_hash FROM public.comms_send_approvals
        WHERE id = $1::uuid AND owner_user_id = $2 AND status = 'pending' AND expires_at > NOW()
        LIMIT 1`,
      request.params.id, userId,
    );
    const action = rows[0];
    if (!action) return reply.code(404).send({ error: 'Pending approval not found or expired.' });
    const policy = genXDecision(userId, action.payload_hash, action.channel);
    if (policy.decision === 'DENY') return reply.code(403).send({ error: 'Gen-X denied this communications action.', ruleId: policy.ruleId });
    const updated = await fastify.prisma.$executeRawUnsafe(
      `UPDATE public.comms_send_approvals
          SET status = 'approved', approved_at = NOW(), policy_rule_id = $3, updated_at = NOW()
        WHERE id = $1::uuid AND owner_user_id = $2 AND status = 'pending' AND expires_at > NOW()`,
      request.params.id, userId, policy.ruleId,
    );
    if (updated !== 1) return reply.code(409).send({ error: 'The approval was already decided or expired.' });
    return { approvalId: request.params.id, status: 'approved', policy: { decision: policy.decision, ruleId: policy.ruleId } };
  });

  fastify.post<{ Params: { id: string } }>('/api/comms/approvals/:id/reject', async (request, reply) => {
    const userId = ownerId(request);
    if (!userId) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid approval ID.' });
    const updated = await fastify.prisma.$executeRawUnsafe(
      `UPDATE public.comms_send_approvals SET status = 'rejected', updated_at = NOW()
        WHERE id = $1::uuid AND owner_user_id = $2 AND status = 'pending' AND expires_at > NOW()`,
      request.params.id, userId,
    );
    if (updated !== 1) return reply.code(404).send({ error: 'Pending approval not found or expired.' });
    return { approvalId: request.params.id, status: 'rejected' };
  });
};
