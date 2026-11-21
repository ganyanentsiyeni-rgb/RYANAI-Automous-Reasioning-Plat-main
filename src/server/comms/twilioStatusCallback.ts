import { createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import twilio from 'twilio';
import type { CommsDeliveryState, RyanAIEvent } from '../selfPatch/ryanAIEventContract.js';
import { ryanAIPaEventBridge } from '../selfPatch/ryanAIPaEventBridge.js';

type TwilioStatusBody = Record<string, string | undefined>;

const TERMINAL_FAILURES = new Set(['failed', 'undelivered', 'busy', 'no-answer', 'canceled']);

export function mapTwilioDeliveryState(channel: string, providerStatus: string): CommsDeliveryState {
  const status = providerStatus.trim().toLowerCase();
  if (TERMINAL_FAILURES.has(status)) return 'failed';
  if (status === 'delivered' && (channel === 'sms' || channel === 'whatsapp')) return 'delivered';
  if (['queued', 'scheduled'].includes(status)) return 'queued';
  if (['accepted', 'sending', 'sent', 'in-progress', 'ringing', 'initiated', 'completed'].includes(status)) {
    // A completed voice call proves call completion, not that the recipient heard the message.
    return 'accepted_by_provider';
  }
  return 'unknown';
}

function statusFromBody(body: TwilioStatusBody): string {
  return (body.MessageStatus || body.SmsStatus || body.CallStatus || '').trim().toLowerCase();
}

function providerIdFromBody(body: TwilioStatusBody): string {
  return (body.MessageSid || body.CallSid || '').trim();
}

function webhookAuth(urlEnv: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const configuredUrl = process.env[urlEnv]?.trim();
    const signature = request.headers['x-twilio-signature'];
    const secureUrl = (() => {
      try {
        return Boolean(configuredUrl && new URL(configuredUrl).protocol === 'https:');
      } catch {
        return false;
      }
    })();
    if (!token || !configuredUrl || !secureUrl) {
      return reply.code(503).send({ accepted: false, state: 'not_configured' });
    }
    if (typeof signature !== 'string' || !twilio.validateRequest(
      token, signature, configuredUrl, (request.body || {}) as Record<string, string>,
    )) return reply.code(401).send({ accepted: false, state: 'unauthorized' });
    const expectedAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const body = request.body as TwilioStatusBody;
    if (expectedAccountSid && body.AccountSid !== expectedAccountSid) {
      return reply.code(401).send({ accepted: false, state: 'account_mismatch' });
    }
  };
}

/**
 * Receives Twilio's signed outbound delivery callbacks. Provider status is
 * persisted against the already-created outbound message before PA observes
 * a metadata-only RyanAI event. No callback body, address, or message content
 * is forwarded to PA.
 */
export const twilioStatusCallbackPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(formbody);
  fastify.post('/api/webhooks/twilio/status', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    preHandler: webhookAuth('TWILIO_STATUS_WEBHOOK_URL'),
  }, async (request, reply) => {
    const body = request.body as TwilioStatusBody;
    const providerMessageId = providerIdFromBody(body);
    const providerStatus = statusFromBody(body);
    if (!providerMessageId || !providerStatus || !/^(SM|MM|CA)[a-f0-9]{32}$/i.test(providerMessageId)) {
      return reply.code(400).send({ accepted: false, state: 'invalid_callback' });
    }

    const message = await fastify.prisma.communicationMessage.findUnique({
      where: { providerMessageId },
      select: { id: true, direction: true, conversation: { select: { channel: true } } },
    });
    // Return a retryable response if the dispatch record has not committed yet.
    if (!message || message.direction !== 'outbound') {
      return reply.code(503).send({ accepted: false, state: 'message_record_not_ready' });
    }

    const channel = message.conversation.channel;
    if (!['whatsapp', 'sms', 'voice'].includes(channel)) {
      return reply.code(400).send({ accepted: false, state: 'unsupported_channel' });
    }
    const deliveryState = mapTwilioDeliveryState(channel, providerStatus);
    await fastify.prisma.communicationMessage.update({
      where: { id: message.id },
      data: { status: providerStatus },
    });
    await fastify.prisma.$executeRawUnsafe(
      `UPDATE public.comms_send_approvals
          SET status = CASE WHEN $2 = 'failed' THEN 'failed' ELSE 'accepted' END,
              provider_status = $3,
              updated_at = NOW()
        WHERE provider_message_id = $1
          AND status IN ('dispatching', 'accepted', 'unknown')`,
      providerMessageId,
      deliveryState,
      providerStatus,
    );

    const commitSha = (
      process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.RENDER_GIT_COMMIT
      || process.env.RAILWAY_GIT_COMMIT_SHA
      || process.env.GITHUB_SHA
      || ''
    ).trim();
    if (/^[a-f0-9]{40}$/i.test(commitSha)) {
      const event: RyanAIEvent = {
        schemaVersion: 1,
        eventType: 'comms.delivery.receipt',
        source: 'ryanai-comms',
        repository: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
        commitSha,
        eventId: randomUUID(),
        correlationId: `twilio:${providerMessageId}`,
        occurredAt: new Date().toISOString(),
        channel: channel as 'whatsapp' | 'sms' | 'voice',
        state: deliveryState,
        providerReferenceHash: createHash('sha256').update(providerMessageId).digest('hex'),
      };
      ryanAIPaEventBridge.publish(event);
    } else {
      request.log.warn({ providerMessageId }, 'Twilio status persisted; PA event omitted because runtime commit SHA is unavailable');
    }

    request.log.info({
      providerMessageId,
      channel,
      providerStatus,
      deliveryState,
    }, 'Authenticated Twilio delivery status persisted');
    return reply.code(202).send({ accepted: true, state: deliveryState });
  });
};
