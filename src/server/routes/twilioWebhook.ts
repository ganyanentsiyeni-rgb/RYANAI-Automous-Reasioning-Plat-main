import { FastifyPluginAsync } from 'fastify';
import twilio from 'twilio';
import formbody from '@fastify/formbody';
import { claimInboundCommunication, recordCommunication } from '../comms/history.js';
import { getOwnerInboundUserId, storeTwilioMediaForCommunication } from '../comms/attachments.js';
import { addressOwnerResponse } from '../../shared/ryanIdentity.js';
import { enqueueInboundCommunicationRun, waitForInboundCommunicationRun } from '../comms/agentRuns.js';
import { isCommunicationsEnabled, isCommunicationsTestAuthorized } from '../comms/featureFlags.js';
import { decideCommsApprovalFromOwner } from '../comms/authorization.js';
import { recordOwnerGitHubPrReviewDecision } from '../githubPrReviewApproval.js';

function normalizePhone(value: string): string {
  return value.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[c] ?? c);
}

export const twilioWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  if (!isCommunicationsEnabled()) {
    fastify.log.info('Twilio webhook routes are disabled by configuration.');
    return;
  }
  await fastify.register(formbody);

  fastify.post('/api/webhooks/twilio/whatsapp', {
    preHandler: async (request, reply) => {
      const token = process.env.TWILIO_AUTH_TOKEN?.trim();
      const webhookUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL?.trim();
      if (!token || !webhookUrl) return reply.code(503).send({ error: 'Webhook authentication is not configured.' });
      const signature = request.headers['x-twilio-signature'];
      if (typeof signature !== 'string' || !twilio.validateRequest(token, signature, webhookUrl, (request.body || {}) as Record<string, string>)) {
        return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
      }
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;
    const senderPhone = body.From ? normalizePhone(body.From) : '';
    const incomingText = body.Body?.trim().slice(0, 4000) || '';
    const ownerPhone = process.env.RYANAI_OWNER_PHONE?.trim();
    const rawCount = body.NumMedia ?? '0';
    if (!/^\d+$/.test(rawCount)) return reply.code(400).send({ error: 'Invalid WhatsApp media count.' });
    const mediaCount = Number(rawCount);
    if (!Number.isSafeInteger(mediaCount) || mediaCount < 0 || mediaCount > 8) return reply.code(400).send({ error: 'WhatsApp media count must be between 0 and 8.' });
    const media = Array.from({ length: mediaCount }, (_, index) => ({
      url: body[`MediaUrl${index}`] || '',
      mimeType: body[`MediaContentType${index}`] || '',
      index,
    }));
    if (!senderPhone || !body.MessageSid || (!incomingText && media.length === 0) || media.some(item => !item.url || !item.mimeType)) {
      return reply.code(400).send({ error: 'Invalid Twilio WhatsApp payload.' });
    }
    if (!ownerPhone) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (senderPhone !== normalizePhone(ownerPhone)) return reply.code(403).send({ error: 'This WhatsApp assistant is privately configured.' });
    const ownerUserId = getOwnerInboundUserId();
    if (!ownerUserId) return reply.code(503).send({ error: 'Inbound WhatsApp processing requires the verified owner Supabase user ID.' });

    let mediaStorageFailed = false;
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'whatsapp',
        externalAddress: senderPhone,
        body: incomingText || `[${media.length} media attachment(s)]`,
        providerMessageId: body.MessageSid,
        status: 'processing',
        ownerUserId,
        ...(media.length ? { metadata: { mediaCount: media.length } } : {}),
      });
      if (!claim.claimed) {
        const previousReply = claim.existing?.metadata && typeof claim.existing.metadata === 'object'
          && !Array.isArray(claim.existing.metadata) ? (claim.existing.metadata as { reply?: unknown }).reply : undefined;
        if (typeof previousReply === 'string' && previousReply.length) {
          reply.type('text/xml');
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply)}</Message></Response>`;
        }
        if (claim.existing?.agentRunId) {
          const resumed = await waitForInboundCommunicationRun(claim.existing.agentRunId, ownerUserId);
          if (resumed.completed) {
            const answer = addressOwnerResponse(resumed.answer || 'I could not prepare a response.');
            await fastify.prisma.communicationMessage.update({
              where: { id: claim.existing.messageId },
              data: { status: 'replied', metadata: { reply: answer, mediaCount: media.length } },
            });
            await recordCommunication(fastify.prisma, {
              channel: 'whatsapp', externalAddress: senderPhone, direction: 'outbound',
              body: answer, status: 'response_generated', metadata: { inReplyTo: body.MessageSid }, ownerUserId,
            });
            reply.type('text/xml');
            return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 4000))}</Message></Response>`;
          }
        }
        reply.type('text/xml');
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      if (media.length) {
        try { await storeTwilioMediaForCommunication(fastify.prisma, body.MessageSid, media); }
        catch (error) { mediaStorageFailed = true; throw error; }
      }
      const githubApprovalCommand = !media.length
        ? incomingText.match(/^GITHUB\s+(APPROVE|REJECT)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s+([a-f0-9]{40})$/i)
        : null;
      if (!media.length && /^GITHUB\b/i.test(incomingText) && !githubApprovalCommand) {
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: body.MessageSid },
          data: { status: 'approval_blocked', metadata: { approvalDecision: 'blocked', reason: 'invalid_github_approval_command' } },
        });
        reply.type('text/xml');
        if (!isCommunicationsTestAuthorized()) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
        return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml('Use: GITHUB APPROVE <approval-id> <40-character-commit-SHA>, or GITHUB REJECT <approval-id> <40-character-commit-SHA>. No GitHub review was submitted.')}</Message></Response>`;
      }
      if (githubApprovalCommand) {
        if (!ownerUserId) {
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: { status: 'approval_blocked', metadata: { approvalDecision: 'blocked', reason: 'owner_identity_not_configured' } },
          });
          reply.type('text/xml');
          return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
        }
        const requestedDecision = githubApprovalCommand[1].toUpperCase() === 'APPROVE' ? 'approve' : 'reject';
        try {
          const decision = await recordOwnerGitHubPrReviewDecision(fastify.prisma, {
            ownerUserId,
            approvalId: githubApprovalCommand[2],
            expectedHeadSha: githubApprovalCommand[3],
            inboundMessageSid: body.MessageSid,
            decision: requestedDecision,
          });
          const confirmation = decision.status === 'approved'
            ? `RyanAI recorded your owner approval for PR #${decision.pull_request_number} at commit ${decision.expected_head_sha}. This records consent only; no GitHub review has been submitted.`
            : `RyanAI recorded your rejection for PR #${decision.pull_request_number} at commit ${decision.expected_head_sha}. No GitHub review was submitted.`;
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: {
              status: 'received',
              metadata: {
                approvalId: decision.id,
                approvalDecision: requestedDecision,
                approvalStatus: decision.status,
                expectedHeadSha: decision.expected_head_sha,
                githubReviewSubmitted: false,
                replySuppressed: !isCommunicationsTestAuthorized(),
              },
            },
          });
          request.log.info({ approvalId: decision.id, decision: decision.status, pullRequestNumber: decision.pull_request_number, expectedHeadSha: decision.expected_head_sha }, 'Owner GitHub PR review decision recorded; no review submitted');
          reply.type('text/xml');
          if (!isCommunicationsTestAuthorized()) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(confirmation)}</Message></Response>`;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'github_pr_review_approval_failed';
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: { status: 'approval_blocked', metadata: { approvalId: githubApprovalCommand[2], approvalDecision: requestedDecision, expectedHeadSha: githubApprovalCommand[3], reason, githubReviewSubmitted: false } },
          });
          request.log.warn({ err: error, approvalId: githubApprovalCommand[2] }, 'Inbound owner GitHub PR approval was not accepted');
          reply.type('text/xml');
          if (!isCommunicationsTestAuthorized()) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml('RyanAI could not accept that GitHub PR decision. Check the approval ID, exact SHA, owner destination verification and expiry. No GitHub review was submitted.')}</Message></Response>`;
        }
      }

      const approvalCommand = !media.length
        ? incomingText.match(/^(APPROVE|REJECT)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
        : null;
      if (approvalCommand) {
        if (!ownerUserId) {
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: { status: 'approval_blocked', metadata: { approvalDecision: 'blocked', reason: 'owner_identity_not_configured' } },
          });
          reply.type('text/xml');
          return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
        }
        const requestedDecision = approvalCommand[1].toUpperCase() === 'APPROVE' ? 'approve' : 'reject';
        try {
          const decision = await decideCommsApprovalFromOwner(
            fastify.prisma,
            ownerUserId,
            approvalCommand[2],
            requestedDecision,
          );
          const confirmation = decision.status === 'approved'
            ? 'RyanAI recorded your approval for this exact communications request. It is ready for dispatch from the Comms console.'
            : 'RyanAI recorded your rejection. This communications request will not be dispatched.';
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: {
              status: 'received',
              metadata: {
                approvalId: decision.approvalId,
                approvalDecision: requestedDecision,
                approvalStatus: decision.status,
                replySuppressed: !isCommunicationsTestAuthorized(),
              },
            },
          });
          request.log.info({ approvalId: decision.approvalId, decision: decision.status }, 'Owner Comms approval decision recorded');
          reply.type('text/xml');
          if (!isCommunicationsTestAuthorized()) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(confirmation)}</Message></Response>`;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'approval_decision_failed';
          await fastify.prisma.communicationMessage.update({
            where: { providerMessageId: body.MessageSid },
            data: { status: 'approval_blocked', metadata: { approvalId: approvalCommand[2], approvalDecision: requestedDecision, reason } },
          });
          request.log.warn({ err: error, approvalId: approvalCommand[2] }, 'Inbound owner approval was not accepted');
          reply.type('text/xml');
          if (!isCommunicationsTestAuthorized()) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml('RyanAI could not accept that approval. Check the request ID and expiry in the Comms console.')}</Message></Response>`;
        }
      }

      if (!isCommunicationsTestAuthorized()) {
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: body.MessageSid },
          data: { status: 'received', metadata: { mediaCount: media.length, replySuppressed: true } },
        });
        reply.type('text/xml');
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      const queued = await enqueueInboundCommunicationRun({
        messageId: claim.messageId!,
        ownerUserId,
        providerMessageId: body.MessageSid,
      });
      const completed = await waitForInboundCommunicationRun(queued.runId, ownerUserId);
      if (!completed.completed) {
        request.log.info({ runId: queued.runId, providerMessageId: body.MessageSid }, 'WhatsApp agent run remains queued or running; webhook will not fabricate a reply');
        reply.type('text/xml');
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      const agentReply = addressOwnerResponse(completed.answer || 'I could not prepare a response.');
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid },
        data: { status: 'replied', metadata: { reply: agentReply, mediaCount: media.length, agentRunId: queued.runId } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'whatsapp', externalAddress: senderPhone, direction: 'outbound',
        body: agentReply, status: 'response_generated', metadata: { inReplyTo: body.MessageSid },
        ownerUserId,
      });
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(agentReply.slice(0, 4000))}</Message></Response>`;
    } catch (error) {
      if (mediaStorageFailed) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: body.MessageSid, status: 'processing' }, data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist WhatsApp media retry state'));
        request.log.error({ err: error }, 'WhatsApp media storage failed');
        return reply.code(503).send({ error: 'Inbound media is temporarily unavailable; the provider may retry this webhook.' });
      }
      request.log.error({ err: error }, 'Error processing WhatsApp message');
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again shortly.</Message></Response>`;
    }
  });
};
