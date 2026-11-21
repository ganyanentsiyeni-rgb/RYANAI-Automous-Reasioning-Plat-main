import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import formbody from '@fastify/formbody';
import rawBody from 'fastify-raw-body';
import { Resend } from 'resend';
import { enqueueInboundCommunicationRun, waitForInboundCommunicationRun, enqueueCommsAssistRun } from './agentRuns.js';
import { beginOutboundCommunication, claimInboundCommunication, completeOutboundCommunication, markOutboundCommunicationUnknown, OutboundIdempotencyConflictError, prepareOutboundCommunication, recordCommunication } from './history.js';
import { addressOwnerMessage, getOwnerGreeting } from './personalization.js';
import { waitForAutonomousTask } from '../../agent/operations.js';
import { createCommsUploadIntents, createCommsStorageAdmin, cleanCommsAttachmentUrls, downloadResendMedia, getCommsAttachmentScanStates, getCommsAttachmentStatuses, getOwnerInboundUserId, storeInboundCommsAttachment, storeTwilioMediaForCommunication } from './attachments.js';
import { addressOwnerResponse, RYANAI_LOCALE } from '../../shared/ryanIdentity.js';
import { areCommunicationAttachmentsEnabled, isCommunicationsEnabled, isCommunicationsTestAuthorized } from './featureFlags.js';
import { assertCommsActionAuthorized, buildCommsActionPayload, claimCommsAction, finishCommsAction } from './authorization.js';

type Channel = 'whatsapp' | 'sms' | 'voice' | 'email';
type CommsBody = { channel?: Channel; recipient?: string; message?: string; subject?: string; contentSid?: string; contentVariables?: string; idempotencyKey?: string; attachmentIds?: string[]; approvalId?: string };
const MAX_MESSAGE_LENGTH = 4000;
const E164 = /^\+[1-9]\d{7,14}$/;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[char] ?? char);
}
function normalizePhone(value: string): string {
  return value.replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}
function emailAddress(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}
function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  return sid && token ? twilio(sid, token) : null;
}
function webhookAuth(urlEnv: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const url = process.env[urlEnv]?.trim();
    const signature = request.headers['x-twilio-signature'];
    if (!token || !url) return reply.code(503).send({ error: 'Twilio webhook authentication is not configured.' });
    const signedUrl = request.url.includes('?') ? new URL(request.url, url).toString() : url;
    if (typeof signature !== 'string' || !twilio.validateRequest(
      token, signature, signedUrl, (request.body || {}) as Record<string, string>,
    )) return reply.code(401).send({ error: 'Invalid Twilio request signature.' });
  };
}
function twimlSay(message: string, gather = true): string {
  const action = process.env.TWILIO_VOICE_ACTION_URL?.trim();
  const voice = escapeXml(process.env.RYANAI_TWILIO_VOICE?.trim() || 'Polly.Ayanda-Neural');
  const say = (value: string) => `<Say language="${RYANAI_LOCALE}" voice="${voice}">${escapeXml(value)}</Say>`;
  if (!action || !gather) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(message)}<Hangup/></Response>`;
  }
  const actionWithTurn = new URL(action);
  actionWithTurn.searchParams.set('turnId', randomUUID());
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(message)}<Gather input="speech" language="${RYANAI_LOCALE}" action="${escapeXml(actionWithTurn.toString())}" method="POST" speechTimeout="auto" timeout="5">${say('Please speak after the tone.')}</Gather>${say('I did not hear a response. Goodbye.')}<Hangup/></Response>`;
}

function parseTwilioMedia(body: Record<string, string | undefined>) {
  const rawCount = body.NumMedia ?? '0';
  if (!/^\d+$/.test(rawCount)) throw new Error('Invalid Twilio media count.');
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0 || count > 8) throw new Error('Twilio media count must be between 0 and 8.');
  return Array.from({ length: count }, (_, index) => {
    const url = body[`MediaUrl${index}`];
    const mimeType = body[`MediaContentType${index}`];
    if (!url || !mimeType) throw new Error('Twilio media payload is incomplete.');
    return { url, mimeType, index };
  });
}

function smtpTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  return {
    from,
    transporter: nodemailer.createTransport({
      host, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    }),
  };
}

/** Real provider-backed channels. Twilio and Resend webhooks are signature verified. */
export const commsPlugin: FastifyPluginAsync = async (fastify) => {
  // Keep the Comms workspace and read-only history/status routes registered.
  // Dispatch remains separately gated below; attachments retain their scanner gate.
  await fastify.register(formbody);
  await fastify.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });


  fastify.post<{ Body: { channel?: Channel; recipient?: string; message?: string; subject?: string; idempotencyKey?: string; files?: Array<{ name: string; mimeType: string; size: number }> } }>('/api/comms/attachments/prepare', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const { channel, recipient, message, subject, idempotencyKey, files } = request.body ?? {};
    if (!channel || !['whatsapp', 'sms', 'email'].includes(channel)) return reply.code(400).send({ error: 'Attachments are supported for WhatsApp, SMS and email.' });
    const targetValue = recipient || (String(channel) === 'email' ? process.env.RYANAI_OWNER_EMAIL : process.env.RYANAI_OWNER_PHONE);
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const bodyText = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!target || !bodyText || bodyText.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ error: 'A recipient and message of at most 4,000 characters are required.' });
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ error: 'A valid 16–128 character idempotency key is required.' });
    if (String(channel) === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) : !E164.test(target)) return reply.code(400).send({ error: 'Recipient address is invalid.' });
    if (!Array.isArray(files)) return reply.code(400).send({ error: 'An attachment file list is required.' });
    try {
      const ownerRecipient = String(channel) === 'email'
        ? target.toLowerCase() === process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase()
        : Boolean(process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
      const prepared = await prepareOutboundCommunication(fastify.prisma, {
        channel,
        externalAddress: String(channel) === 'email' ? target.toLowerCase() : target,
        body: ownerRecipient ? addressOwnerMessage(bodyText) : bodyText,
        idempotencyKey: key,
        ownerUserId: request.authUser.id,
        ...(String(channel) === 'email' ? { metadata: { subject: typeof subject === 'string' && subject.trim() ? subject.trim() : 'RyanAI notification' } } : {}),
      });
      const uploads = await createCommsUploadIntents(fastify.prisma, request.authUser.id, prepared.id, files);
      return reply.code(prepared.replayed ? 200 : 201).send({ success: true, messageId: prepared.id, replayed: prepared.replayed, attachments: uploads });
    } catch (error) {
      request.log.warn({ err: error }, 'Comms attachment preparation rejected');
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to prepare attachment uploads.' });
    }
  });

  fastify.get<{ Querystring: { ids?: string } }>('/api/comms/attachments/status', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const ids = (request.query.ids || '').split(',').filter(Boolean);
    if (!ids.length || ids.length > 8 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return reply.code(400).send({ error: 'Provide 1–8 valid attachment IDs.' });
    try {
      const attachments = await getCommsAttachmentStatuses(fastify.prisma, request.authUser.id, ids);
      return { attachments };
    } catch {
      return reply.code(404).send({ error: 'One or more attachments were not found for this owner.' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/comms/attachments/:id/download', async (request, reply) => {
    if (!areCommunicationAttachmentsEnabled()) return reply.code(503).send({ error: 'Communication attachments are disabled.' });
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Invalid attachment ID.' });
    try {
      const urls = await cleanCommsAttachmentUrls(fastify.prisma, request.authUser.id, [request.params.id], 60);
      return { url: urls.get(request.params.id) };
    } catch {
      return reply.code(404).send({ error: 'Attachment is not available until its security scan is clean.' });
    }
  });

  fastify.post<{ Body: { operation?: 'summarize' | 'draft' | 'translate' | 'extract_tasks'; conversationId?: string; language?: string; instruction?: string; idempotencyKey?: string } }>('/api/comms/assist', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required for communications intelligence.' });
    const operation = request.body?.operation;
    const conversationId = request.body?.conversationId?.trim();
    const language = request.body?.language?.trim();
    const instruction = request.body?.instruction?.trim();
    if (!operation || !['summarize', 'draft', 'translate', 'extract_tasks'].includes(operation)) {
      return reply.code(400).send({ error: 'Unsupported communications intelligence operation.' });
    }
    if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
      return reply.code(400).send({ error: 'A valid conversation ID is required.' });
    }
    if (instruction && instruction.length > 1000) {
      return reply.code(400).send({ error: 'The additional instruction is too long.' });
    }
    const idempotencyKey = request.body?.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: 'A valid 16–128 character request idempotency key is required.' });
    }

    const conversation = await fastify.prisma.communicationConversation.findFirst({
      where: { id: conversationId, ownerUserId: request.authUser.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: { direction: true, body: true, status: true, createdAt: true },
        },
      },
    });
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found for this owner.' });

    const transcript = conversation.messages.map((item) =>
      `[${item.createdAt.toISOString()}] ${item.direction} (${item.status}): ${item.body}`,
    ).join('\n');
    const prompts: Record<string, string> = {
      summarize: 'Summarize this conversation into concise, factual bullets. Separate confirmed facts, open questions and next steps. Do not invent details.',
      draft: 'Prepare a proposed reply to the latest inbound message. Preserve the conversation context and owner intent. This is a draft only and must never imply approval or sending.',
      translate: `Translate the conversation context into ${language || 'the requested target language'}. Preserve meaning and names. Return only the translated text.`,
      extract_tasks: 'Extract actionable tasks from the conversation. For each task give owner, action, due date if explicitly stated, and evidence from the transcript. If a field is unknown, say unknown. Do not create or execute tasks.',
    };
    const prompt = [
      prompts[operation],
      instruction ? `Additional owner instruction: ${instruction}` : '',
      '',
      'Conversation transcript:',
      transcript || '(no messages)',
    ].filter(Boolean).join('\n');

    try {
      const queued = await enqueueCommsAssistRun({
        ownerUserId: request.authUser.id,
        idempotencyKey,
        objective: prompt,
      });
      const completed = await waitForAutonomousTask(queued.runId, request.authUser.id, 8_000);
      const output = typeof completed === 'string' ? completed
        : typeof completed === 'object' && completed !== null && 'result' in completed
          ? String((completed as { result: unknown }).result)
          : JSON.stringify(completed);
      return { operation, output, sourceMessageCount: conversation.messages.length, runId: queued.runId };
    } catch (error) {
      if (error instanceof Error && error.message.includes('still queued or running')) {
        return reply.code(202).send({ operation, processing: true, retryable: true });
      }
      request.log.warn({ err: error, operation }, 'Comms intelligence durable run failed');
      return reply.code(502).send({ error: 'Communications intelligence is temporarily unavailable.' });
    }
  });

  fastify.post<{ Body: CommsBody }>('/api/comms/send', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ success: false, error: 'Owner access is required for outbound communications.' });
    if (!isCommunicationsEnabled()) return reply.code(503).send({ success: false, error: 'Outbound communications are disabled by configuration. Comms history and workspace access remain available.' });
    if (!isCommunicationsTestAuthorized()) return reply.code(503).send({ success: false, error: 'Outbound provider dispatch is disabled until an owner explicitly authorizes a communications test.' });
    const { channel, recipient, message, subject, contentSid, contentVariables, idempotencyKey, attachmentIds = [] } = request.body ?? {};
    if (attachmentIds.length && !areCommunicationAttachmentsEnabled()) return reply.code(503).send({ success: false, error: 'Communication attachments are disabled.' });
    if (!channel || !['whatsapp', 'sms', 'voice', 'email'].includes(channel)) return reply.code(400).send({ success: false, error: 'Unsupported communication channel.' });
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 8 || new Set(attachmentIds).size !== attachmentIds.length) return reply.code(400).send({ success: false, error: 'At most 8 unique attachment IDs are supported.' });
    if (attachmentIds.length && (channel === 'voice' || (channel === 'whatsapp' && Boolean(contentSid || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim())))) return reply.code(400).send({ success: false, error: 'Voice and approved WhatsApp template sends cannot include attachments.' });
    const targetValue = recipient || process.env.RYANAI_OWNER_PHONE;
    const target = typeof targetValue === 'string' ? targetValue.trim() : '';
    const messageBody = typeof message === 'string' ? message.trim() : '';
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const isOwnerRecipient = Boolean(target && process.env.RYANAI_OWNER_PHONE && normalizePhone(target) === normalizePhone(process.env.RYANAI_OWNER_PHONE));
    const deliveryBody = isOwnerRecipient ? addressOwnerMessage(messageBody) : messageBody;
    const emailSubject = typeof subject === 'string' && subject.trim() ? subject.trim() : 'RyanAI notification';
    const approvedTemplateSid = typeof contentSid === 'string' ? contentSid.trim() || process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim() : process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim();
    if (!key || key.length < 16 || key.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(key)) return reply.code(400).send({ success: false, error: 'A valid 16–128 character idempotency key is required.' });
    if (!target || ((!messageBody) && !(channel === 'whatsapp' && approvedTemplateSid)) || messageBody.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ success: false, error: 'channel, recipient and a message of at most 4,000 characters are required.' });
    if (!E164.test(target)) return reply.code(400).send({ success: false, error: 'Recipient must be a valid E.164 phone number.' });
    const client = twilioClient();
    if (!client) return reply.code(503).send({ success: false, error: 'Twilio is not configured.' });
    const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
    const statusWebhookUrl = process.env.TWILIO_STATUS_WEBHOOK_URL?.trim();
    let callbackIsSecure: boolean;
    try { callbackIsSecure = Boolean(statusCallbackUrl && new URL(statusCallbackUrl).protocol === 'https:'); } catch { callbackIsSecure = false; }
    if (!callbackIsSecure || statusCallbackUrl !== statusWebhookUrl) {
      return reply.code(503).send({ success: false, error: 'A matching HTTPS Twilio delivery-status callback and signature-verification URL are required. No provider request was sent.' });
    }
    let from = '';
    if (channel === 'whatsapp') from = process.env.TWILIO_WHATSAPP_NUMBER?.trim() || '';
    else if (channel === 'sms' || channel === 'voice') from = process.env.TWILIO_PHONE_NUMBER?.trim() || '';
    if (!from) return reply.code(503).send({ success: false, error: `Twilio ${channel} sender is not configured.` });
    if (channel === 'voice' && !process.env.TWILIO_VOICE_ACTION_URL?.trim()) return reply.code(503).send({ success: false, error: 'Twilio voice action URL is not configured.' });
    const outboundBody = deliveryBody || '[WhatsApp approved template]';
    const approvalId = typeof request.body?.approvalId === 'string' ? request.body.approvalId.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return reply.code(400).send({ success: false, error: 'A valid owner approval ID is required.' });
    const actionPayload = buildCommsActionPayload({
      channel, recipient: target, body: outboundBody, subject: emailSubject,
      contentSid: approvedTemplateSid || null,
      contentVariables: typeof contentVariables === 'string' ? contentVariables : null,
      idempotencyKey: key, attachmentIds,
    });
    try {
      await assertCommsActionAuthorized(fastify.prisma, request.authUser.id, approvalId, actionPayload);
    } catch (error) {
      return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : 'A current owner approval is required.' });
    }
    let attachmentUrls: string[] = [];
    if (attachmentIds.length) {
      try {
        const states = await getCommsAttachmentStatuses(fastify.prisma, request.authUser.id, attachmentIds);
        if (states.length !== attachmentIds.length || states.some(item => item.status !== 'clean')) return reply.code(409).send({ success: false, error: 'Attachments are not ready. All malware scans must be clean before sending.' });
        attachmentUrls = [...(await cleanCommsAttachmentUrls(fastify.prisma, request.authUser.id, attachmentIds, 900)).values()];
      } catch (error) {
        request.log.warn({ err: error }, 'Attachment validation blocked outbound send');
        return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : 'Attachments are not ready.' });
      }
    }
    let reservation;
    try {
      reservation = await beginOutboundCommunication(fastify.prisma, {
        channel,
        externalAddress: target,
        body: outboundBody,
        idempotencyKey: key,
        ownerUserId: request.authUser.id,
      });
    } catch (error) {
      if (error instanceof OutboundIdempotencyConflictError) return reply.code(409).send({ success: false, error: error.message });
      request.log.error({ err: error, channel }, 'Unable to reserve outbound communication');
      return reply.code(503).send({ success: false, error: 'The communication could not be safely reserved. No provider request was sent.' });
    }
    if (reservation.replayed) return reply.code(202).send({
      success: true, channel, providerId: reservation.providerMessageId, status: reservation.status, replayed: true,
    });
    try {
      await claimCommsAction(fastify.prisma, request.authUser.id, approvalId, actionPayload);
    } catch (error) {
      return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : 'The owner approval could not be claimed.' });
    }
    try {
      if (channel === 'whatsapp' || channel === 'sms') {
        const sent = await client!.messages.create({
          from: channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
          to: channel === 'whatsapp' ? `whatsapp:${target}` : target,
          ...(channel === 'whatsapp' && approvedTemplateSid
            ? { contentSid: approvedTemplateSid, ...(typeof contentVariables === 'string' ? { contentVariables } : {}) }
            : { body: deliveryBody }),
          ...(attachmentUrls.length ? { mediaUrl: attachmentUrls } : {}),
          statusCallback: statusCallbackUrl!,
        });
        await completeOutboundCommunication(fastify.prisma, { id: reservation.id, providerMessageId: sent.sid, status: sent.status });
        await finishCommsAction(fastify.prisma, approvalId, { status: 'accepted', providerMessageId: sent.sid, providerStatus: sent.status });
        return reply.code(202).send({ success: true, channel, providerId: sent.sid, status: sent.status, replayed: false });
      }
      const call = await client!.calls.create({
        to: target, from, twiml: twimlSay(deliveryBody),
        statusCallback: statusCallbackUrl!,
      });
      await completeOutboundCommunication(fastify.prisma, { id: reservation.id, providerMessageId: call.sid, status: call.status });
      await finishCommsAction(fastify.prisma, approvalId, { status: 'accepted', providerMessageId: call.sid, providerStatus: call.status });
      return reply.code(202).send({ success: true, channel, providerId: call.sid, status: call.status, replayed: false });
    } catch (error) {
      try { await finishCommsAction(fastify.prisma, approvalId, { status: 'unknown' }); }
      catch (approvalPersistenceError) { request.log.error({ err: approvalPersistenceError, channel }, 'Unable to mark communications approval outcome as unknown'); }
      try { await markOutboundCommunicationUnknown(fastify.prisma, reservation.id); }
      catch (persistenceError) { request.log.error({ err: persistenceError, channel }, 'Unable to mark outbound communication outcome as unknown'); }
      request.log.error({ err: error, channel }, 'Communication provider request or result persistence failed');
      return reply.code(502).send({ success: false, error: 'Communication outcome is unknown. The idempotency key remains reserved to prevent duplicate dispatch.' });
    }
  });

  fastify.get('/api/comms/conversations', async (request, reply) => {
    if (!request.authUser?.isOwner) return reply.code(403).send({ error: 'Owner access is required.' });
    const rawLimit = Number((request.query as { limit?: string })?.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;
    const ownerUserId = request.authUser.id;
    const conversations = await fastify.prisma.communicationConversation.findMany({
      where: { ownerUserId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true, channel: true, externalAddress: true, updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true, direction: true, body: true, status: true,
            providerMessageId: true, metadata: true, createdAt: true,
            attachments: { select: { id: true, fileName: true, mimeType: true, size: true, objectName: true } },
          },
        },
      },
    });
    const allAttachments = conversations.flatMap(item => item.messages.flatMap(message => message.attachments));
    let states: Record<string, string> = {};
    if (allAttachments.length) {
      try { states = await getCommsAttachmentScanStates(createCommsStorageAdmin(), allAttachments.map(item => ({ id: item.id, objectName: item.objectName }))); }
      catch (error) { request.log.warn({ err: error }, 'Unable to read attachment scan states'); }
    }
    return {
      status: 'history',
      conversations: conversations.map((conversation) => ({
        ...conversation,
        messages: [...conversation.messages].reverse().map(message => ({
          ...message,
          attachments: message.attachments.map(attachment => ({
            id: attachment.id, name: attachment.fileName, mimeType: attachment.mimeType,
            size: Number(attachment.size), status: states[attachment.id] || 'unavailable',
          })),
        })),
      })),
      pagination: { limit, returned: conversations.length },
    };
  });

  fastify.get('/api/comms/status', async () => ({
    status: 'configuration_snapshot',
    enabled: isCommunicationsEnabled(),
    channels: {
      whatsapp: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER && process.env.TWILIO_WHATSAPP_WEBHOOK_URL && process.env.RYANAI_OWNER_PHONE),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_SMS_WEBHOOK_URL && process.env.RYANAI_OWNER_PHONE),
      voice: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER && process.env.TWILIO_VOICE_WEBHOOK_URL && process.env.TWILIO_VOICE_ACTION_URL),
      email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM && process.env.RYANAI_OWNER_EMAIL),
      inboundEmail: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET),
      attachments: areCommunicationAttachmentsEnabled() && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    ai: {
      openai: {
        status: process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_BASE_URL?.trim()
          ? 'configured_unverified'
          : 'missing_credentials',
      },
    },
    note: 'Configuration presence only; this endpoint does not claim live provider connectivity or successful model authentication.',
  }));

  fastify.post('/api/webhooks/twilio/voice', { preHandler: webhookAuth('TWILIO_VOICE_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as { From?: string; CallSid?: string };
    const sender = body.From ? normalizePhone(body.From) : '';
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (sender !== normalizePhone(owner)) return reply.code(403).send({ error: 'This voice assistant is privately configured.' });
    if (!isCommunicationsTestAuthorized()) { reply.type('text/xml'); return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'; }
    if (body.CallSid) await recordCommunication(fastify.prisma, {
      channel: 'voice', externalAddress: sender, direction: 'inbound',
      body: 'Incoming voice call started', providerMessageId: body.CallSid, status: 'in_progress', ownerUserId: process.env.RYANAI_OWNER_AUTH_USER_ID,
    });
    reply.type('text/xml');
    return twimlSay(getOwnerGreeting());
  });

  fastify.post('/api/webhooks/twilio/voice/respond', { preHandler: webhookAuth('TWILIO_VOICE_ACTION_URL') }, async (request, reply) => {
    const body = request.body as { SpeechResult?: string; CallSid?: string; From?: string; To?: string };
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    const ownerPhone = normalizePhone(owner);
    const fromPhone = body.From ? normalizePhone(body.From) : '';
    const toPhone = body.To ? normalizePhone(body.To) : '';
    const sender = fromPhone === ownerPhone ? fromPhone : toPhone === ownerPhone ? toPhone : '';
    const speech = body.SpeechResult?.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!sender) return reply.code(403).send({ error: 'This voice assistant is privately configured.' });
    const outboundReplyAllowed = isCommunicationsTestAuthorized();
    reply.type('text/xml');
    if (!speech) return twimlSay('I did not catch that. Please try again.', true);
    const callSid = body.CallSid?.trim();
    const turnId = typeof request.query === 'object' && request.query !== null && 'turnId' in request.query
      ? String((request.query as { turnId?: unknown }).turnId || '') : '';
    const ownerUserId = getOwnerInboundUserId();
    if (!callSid || !/^[A-Za-z0-9_-]{1,80}$/.test(callSid) || !turnId || !/^[0-9a-f-]{36}$/i.test(turnId)) {
      return reply.code(400).send({ error: 'A valid call ID and signed voice turn ID are required.' });
    }
    if (!ownerUserId) return reply.code(503).send({ error: 'Inbound voice processing requires the verified owner Supabase user ID.' });
    const providerTurnId = `voice:${callSid}:${turnId}`;
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'voice', externalAddress: sender, direction: 'inbound', body: speech,
        providerMessageId: providerTurnId, status: 'processing', metadata: { callSid, turnId }, ownerUserId,
      });
      if (!claim.claimed && claim.existing) {
        const metadata = claim.existing.metadata && typeof claim.existing.metadata === 'object' && !Array.isArray(claim.existing.metadata)
          ? claim.existing.metadata as Record<string, unknown> : {};
        if (typeof metadata.reply === 'string' && metadata.reply) {
          return outboundReplyAllowed ? twimlSay(metadata.reply, true) : '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
        }
        if (claim.existing.agentRunId) {
          const resumed = await waitForInboundCommunicationRun(claim.existing.agentRunId, ownerUserId);
          if (resumed.completed && outboundReplyAllowed) {
            const answer = addressOwnerResponse(resumed.answer);
            await fastify.prisma.communicationMessage.update({
              where: { id: claim.existing.messageId },
              data: { status: 'replied', metadata: { ...metadata, reply: answer, agentRunId: claim.existing.agentRunId } },
            });
            return twimlSay(answer.slice(0, MAX_MESSAGE_LENGTH), true);
          }
        }
        return outboundReplyAllowed
          ? twimlSay('I am still processing your previous request. Please hold for a moment.', true)
          : '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
      }
      if (!claim.messageId) throw new Error('Voice message claim did not return a persisted message ID.');
      const queued = await enqueueInboundCommunicationRun({ messageId: claim.messageId, ownerUserId, providerMessageId: providerTurnId });
      const completed = await waitForInboundCommunicationRun(queued.runId, ownerUserId);
      if (!completed.completed) return twimlSay('I am still processing that. Please give me a moment and try again.', true);
      if (!outboundReplyAllowed) return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
      const answer = addressOwnerResponse(completed.answer);
      await fastify.prisma.communicationMessage.update({
        where: { id: claim.messageId },
        data: { status: 'replied', metadata: { callSid, turnId, reply: answer, agentRunId: queued.runId } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'voice', externalAddress: sender, direction: 'outbound',
        body: answer, providerMessageId: `voice-reply:${callSid}:${turnId}`,
        status: 'response_generated', metadata: { callSid, turnId, agentRunId: queued.runId }, ownerUserId,
      });
      return twimlSay(answer.slice(0, MAX_MESSAGE_LENGTH), true);
    } catch (error) {
      request.log.error({ err: error }, 'RyanAI durable voice turn failed');
      return twimlSay('I am temporarily unable to process that request. Please try again later.', false);
    }
  });

  fastify.post('/api/webhooks/twilio/sms', { preHandler: webhookAuth('TWILIO_SMS_WEBHOOK_URL') }, async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;
    const sender = body.From ? normalizePhone(body.From) : '';
    const text = body.Body?.trim().slice(0, MAX_MESSAGE_LENGTH) || '';
    const owner = process.env.RYANAI_OWNER_PHONE?.trim();
    let media: ReturnType<typeof parseTwilioMedia>;
    try { media = parseTwilioMedia(body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid Twilio media payload.' }); }
    if (!sender || !body.MessageSid || (!text && media.length === 0)) return reply.code(400).send({ error: 'Invalid SMS webhook payload.' });
    if (!owner) return reply.code(503).send({ error: 'RyanAI owner contact is not configured.' });
    if (sender !== normalizePhone(owner)) return reply.code(403).send({ error: 'This assistant is privately configured.' });
    const outboundReplyAllowed = isCommunicationsTestAuthorized();
    const ownerUserId = getOwnerInboundUserId();
    if (!ownerUserId) return reply.code(503).send({ error: 'Inbound SMS processing requires the verified owner Supabase user ID.' });
    let mediaStorageFailed = false;
    try {
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'sms',
        externalAddress: sender,
        body: text || `[${media.length} media attachment(s)]`,
        providerMessageId: body.MessageSid,
        status: 'processing',
        ownerUserId,
        ...(media.length ? { metadata: { mediaCount: media.length } } : {}),
      });
      if (!claim.claimed) {
        const previousReply = claim.existing?.metadata && typeof claim.existing.metadata === 'object'
          && !Array.isArray(claim.existing.metadata)
          ? (claim.existing.metadata as { reply?: unknown }).reply : undefined;
        reply.type('text/xml');
        if (typeof previousReply === 'string' && previousReply.length && outboundReplyAllowed) {
          return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(previousReply.slice(0, 1600))}</Message></Response>`;
        }
        if (claim.existing?.agentRunId) {
          const resumed = await waitForInboundCommunicationRun(claim.existing.agentRunId, ownerUserId);
          if (resumed.completed && outboundReplyAllowed) {
            const answer = addressOwnerResponse(resumed.answer || 'I could not prepare a response.');
            await fastify.prisma.communicationMessage.update({
              where: { id: claim.existing.messageId },
              data: { status: 'replied', metadata: { reply: answer, mediaCount: media.length, agentRunId: claim.existing.agentRunId } },
            });
            await recordCommunication(fastify.prisma, {
              channel: 'sms', externalAddress: sender, direction: 'outbound', body: answer,
              status: 'response_generated', metadata: { inReplyTo: body.MessageSid }, ownerUserId,
            });
            return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 1600))}</Message></Response>`;
          }
        }
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      if (media.length) {
        try { await storeTwilioMediaForCommunication(fastify.prisma, body.MessageSid, media); }
        catch (error) { mediaStorageFailed = true; throw error; }
      }
      const queued = await enqueueInboundCommunicationRun({
        messageId: claim.messageId!,
        ownerUserId,
        providerMessageId: body.MessageSid,
      });
      const completed = await waitForInboundCommunicationRun(queued.runId, ownerUserId);
      if (!completed.completed) {
        request.log.info({ runId: queued.runId, providerMessageId: body.MessageSid }, 'SMS agent run remains queued or running; webhook will not fabricate a reply');
        reply.type('text/xml');
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      if (!outboundReplyAllowed) {
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: body.MessageSid },
          data: { status: 'received', metadata: { mediaCount: media.length, replySuppressed: true, agentRunId: queued.runId } },
        });
        reply.type('text/xml');
        return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      }
      const answer = addressOwnerResponse(completed.answer || 'I could not prepare a response.');
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: body.MessageSid },
        data: { status: 'replied', metadata: { reply: answer, mediaCount: media.length, agentRunId: queued.runId } },
      });
      await recordCommunication(fastify.prisma, {
        channel: 'sms', externalAddress: sender, direction: 'outbound', body: answer,
        status: 'response_generated', metadata: { inReplyTo: body.MessageSid },
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(answer.slice(0, 1600))}</Message></Response>`;
    } catch (error) {
      if (mediaStorageFailed) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: body.MessageSid, status: 'processing' },
          data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist inbound media retry state'));
        request.log.error({ err: error }, 'Inbound SMS media storage failed');
        return reply.code(503).send({ error: 'Inbound media is temporarily unavailable; the provider may retry this webhook.' });
      }
      request.log.error({ err: error }, 'RyanAI SMS conversation failed');
      reply.type('text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>RyanAI is temporarily unavailable. Please try again later.</Message></Response>`;
    }
  });

  fastify.post('/api/webhooks/resend/inbound', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim().toLowerCase();
    if (!apiKey || !secret || !ownerEmail) {
      return reply.code(503).send({ error: 'Inbound email is not configured.' });
    }
    const resend = new Resend(apiKey);
    let claimedEmailId: string | undefined;
    let inboundAttachmentStorageFailed = false;
    try {
      const event = resend.webhooks.verify({
        payload: typeof request.rawBody === 'string' ? request.rawBody : request.rawBody?.toString('utf8') ?? '',
        headers: {
          id: String(request.headers['svix-id'] ?? ''),
          timestamp: String(request.headers['svix-timestamp'] ?? ''),
          signature: String(request.headers['svix-signature'] ?? ''),
        },
        webhookSecret: secret,
      }) as { type?: string; data?: { email_id?: string; from?: string } };
      if (event.type !== 'email.received' || !event.data?.email_id) {
        return { received: true, ignored: true };
      }
      const received = await resend.emails.receiving.get(event.data.email_id);
      if (received.error || !received.data) {
        request.log.error({ error: received.error }, 'Could not retrieve inbound email content');
        return reply.code(502).send({ error: 'Could not retrieve inbound email content.' });
      }
      const email = received.data as { id: string; from: string; subject?: string; text?: string | null; html?: string | null };
      const sender = emailAddress(email.from);
      if (sender !== ownerEmail) {
        request.log.warn({ sender }, 'Rejected inbound email from non-owner sender');
        return reply.code(403).send({ error: 'This email assistant is privately configured.' });
      }
      const bodyText = (email.text || email.html?.replace(/<[^>]*>/g, ' ') || '').trim().slice(0, MAX_MESSAGE_LENGTH);
      const listed = await resend.emails.receiving.attachments.list({ emailId: email.id });
      if (listed.error || !listed.data) {
        request.log.error({ error: listed.error }, 'Could not list inbound email attachments');
        return reply.code(502).send({ error: 'Could not list inbound email attachments.' });
      }
      const inboundAttachments = listed.data.data ?? [];
      if (inboundAttachments.length > 8 || listed.data.has_more) return reply.code(413).send({ error: 'Inbound email exceeds the eight-attachment limit.' });
      if (!bodyText && inboundAttachments.length === 0) return reply.code(400).send({ error: 'Inbound email has no readable text body or supported attachments.' });
      const ownerUserId = getOwnerInboundUserId();
      if (!ownerUserId) return reply.code(503).send({ error: 'Inbound email processing requires the verified owner Supabase user ID.' });
      const claim = await claimInboundCommunication(fastify.prisma, {
        channel: 'email',
        externalAddress: sender,
        body: bodyText || `[${inboundAttachments.length} email attachment(s)]`,
        providerMessageId: email.id,
        status: 'processing',
        metadata: { subject: email.subject || '', attachmentCount: inboundAttachments.length },
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      if (!claim.claimed && (!claim.existing?.agentRunId || ['replied', 'reply_dispatch_unknown'].includes(claim.existing.status))) {
        return { received: true, duplicate: true, status: claim.existing?.status ?? 'unknown' };
      }
      claimedEmailId = email.id;
      if (claim.claimed && inboundAttachments.length) {
        try {
          const storedMessage = await fastify.prisma.communicationMessage.findUnique({
          where: { id: claim.messageId },
          select: { id: true, conversationId: true },
        });
        if (!storedMessage) throw new Error('Inbound email attachments lack a persisted communication message.');
        for (const attachment of inboundAttachments) {
          if (!attachment.download_url || !attachment.content_type) throw new Error('Resend attachment metadata is incomplete.');
          const bytes = await downloadResendMedia(attachment.download_url);
          await storeInboundCommsAttachment(fastify.prisma, {
            ownerUserId,
            messageId: storedMessage.id,
            conversationId: storedMessage.conversationId,
            fileName: attachment.filename || `resend-attachment-${attachment.id}`,
            mimeType: attachment.content_type,
            bytes,
            source: 'inbound_resend',
            providerMediaId: attachment.id,
          });
          }
        } catch (attachmentError) {
          inboundAttachmentStorageFailed = true;
          throw attachmentError;
        }
      }
      const queued = await enqueueInboundCommunicationRun({
        messageId: claim.messageId ?? claim.existing!.messageId,
        ownerUserId,
        providerMessageId: email.id,
      });
      const completed = await waitForInboundCommunicationRun(queued.runId, ownerUserId);
      if (!completed.completed) {
        request.log.info({ runId: queued.runId, providerMessageId: email.id }, 'Inbound email agent run remains queued or running');
        return reply.code(503).send({ received: true, processing: true, retryable: true, runId: queued.runId });
      }
      const answer = addressOwnerResponse(completed.answer || 'I could not prepare a response.');
      await fastify.prisma.communicationMessage.update({
        where: { providerMessageId: email.id },
        data: { status: 'reply_prepared', metadata: { subject: email.subject || '', reply: answer, agentRunId: queued.runId } },
      });
      const smtp = smtpTransport();
      if (!smtp) {
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: email.id },
          data: { status: 'reply_not_sent', metadata: { subject: email.subject || '', reply: answer, agentRunId: queued.runId } },
        });
        return reply.code(503).send({ error: 'SMTP reply channel is not configured; inbound message and agent run were saved.' });
      }
      const outbound = await beginOutboundCommunication(fastify.prisma, {
        channel: 'email',
        externalAddress: sender,
        body: answer,
        idempotencyKey: `resend-inbound-reply:${email.id}`,
        ownerUserId,
        metadata: { inReplyTo: email.id, subject: `Re: ${email.subject || 'Message to RyanAI'}`, agentRunId: queued.runId },
      });
      if (outbound.replayed) {
        const alreadyAccepted = outbound.status === 'accepted' && Boolean(outbound.providerMessageId);
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: email.id },
          data: { status: alreadyAccepted ? 'replied' : 'reply_dispatch_unknown',
            metadata: { subject: email.subject || '', reply: answer, agentRunId: queued.runId, outboundMessageId: outbound.id } },
        });
        return { received: true, replied: alreadyAccepted, dispatchPending: !alreadyAccepted };
      }
      try {
        const sent = await smtp.transporter.sendMail({
          from: smtp.from, to: sender,
          subject: `Re: ${email.subject || 'Message to RyanAI'}`, text: answer,
        });
        await completeOutboundCommunication(fastify.prisma, {
          id: outbound.id, providerMessageId: sent.messageId, status: 'accepted',
        });
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: email.id },
          data: { status: 'replied', metadata: { subject: email.subject || '', reply: answer, agentRunId: queued.runId, outboundMessageId: outbound.id } },
        });
        return { received: true, replied: true, providerAccepted: true };
      } catch (sendError) {
        await markOutboundCommunicationUnknown(fastify.prisma, outbound.id).catch((persistError) => {
          request.log.error({ err: persistError, outboundMessageId: outbound.id }, 'Unable to persist ambiguous SMTP dispatch state');
        });
        await fastify.prisma.communicationMessage.update({
          where: { providerMessageId: email.id },
          data: { status: 'reply_dispatch_unknown', metadata: { subject: email.subject || '', reply: answer, agentRunId: queued.runId, outboundMessageId: outbound.id } },
        }).catch((persistError) => request.log.error({ err: persistError }, 'Unable to persist inbound email reply state'));
        throw sendError;
      }
    } catch (error) {
      if (inboundAttachmentStorageFailed && claimedEmailId) {
        await fastify.prisma.communicationMessage.updateMany({
          where: { providerMessageId: claimedEmailId, status: 'processing' },
          data: { status: 'attachment_failed' },
        }).catch((persistenceError) => request.log.error({ err: persistenceError }, 'Unable to persist inbound email attachment retry state'));
      }
      request.log.error({ err: error }, 'Resend inbound email webhook failed');
      return reply.code(502).send({ error: 'Inbound email processing failed.' });
    }
  });
};
