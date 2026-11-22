import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { commsPlugin } from './index.js';
import { installAuthentication } from '../routes/auth.js';

const { enqueueInboundCommunicationRun, waitForInboundCommunicationRun, enqueueCommsAssistRun, waitForAutonomousTask, prismaMock } = vi.hoisted(() => ({
  enqueueInboundCommunicationRun: vi.fn(),
  waitForInboundCommunicationRun: vi.fn(),
  enqueueCommsAssistRun: vi.fn(),
  waitForAutonomousTask: vi.fn(),
  prismaMock: {
    communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    communicationMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock('./agentRuns.js', () => ({
  enqueueInboundCommunicationRun,
  waitForInboundCommunicationRun,
  enqueueCommsAssistRun,
}));
vi.mock('../../agent/operations.js', () => ({ waitForAutonomousTask }));

const apps: FastifyInstance[] = [];
const token = 'synthetic-voice-auth-token';
const voiceUrl = 'https://ryanai.example.test/api/webhooks/twilio/voice';
const actionUrl = 'https://ryanai.example.test/api/webhooks/twilio/voice/respond';
const smsUrl = 'https://ryanai.example.test/api/webhooks/twilio/sms';
const statusUrl = 'https://ryanai.example.test/api/webhooks/twilio/status';

async function send(path: string, url: string, payload: Record<string, string>, valid = true) {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  app.addHook('onRequest', async (request) => {
    request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
  });
  app.decorate('prisma', prismaMock as never);
  await app.register(commsPlugin);
  const signature = valid
    ? twilio.getExpectedTwilioSignature(token, url, payload)
    : 'invalid-signature';
  return app.inject({
    method: 'POST',
    url: path,
    payload: new URLSearchParams(payload).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
  });
}

beforeEach(() => {
  vi.stubEnv('COMMUNICATIONS_ENABLED', 'true');
  vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'true');
  prismaMock.communicationConversation.upsert.mockResolvedValue({ id: 'conversation-1' });
  prismaMock.communicationConversation.findMany.mockResolvedValue([]);
  prismaMock.communicationConversation.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.communicationConversation.findFirst.mockResolvedValue({ id: 'conversation-1', messages: [{ direction: 'inbound', body: 'Please confirm the delivery window.', status: 'received', createdAt: new Date('2026-11-05T10:00:00.000Z') }] });
  prismaMock.$executeRawUnsafe.mockResolvedValue(1);
  prismaMock.$queryRawUnsafe.mockResolvedValue([]);
  prismaMock.communicationMessage.findUnique.mockResolvedValue(null);
  prismaMock.communicationMessage.upsert.mockResolvedValue({});
  prismaMock.communicationMessage.update.mockResolvedValue({});
  prismaMock.communicationMessage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.communicationMessage.create.mockResolvedValue({});
  vi.stubEnv('TWILIO_AUTH_TOKEN', token);
  vi.stubEnv('TWILIO_VOICE_WEBHOOK_URL', voiceUrl);
  vi.stubEnv('TWILIO_VOICE_ACTION_URL', actionUrl);
  vi.stubEnv('TWILIO_SMS_WEBHOOK_URL', smsUrl);
  vi.stubEnv('TWILIO_STATUS_WEBHOOK_URL', statusUrl);
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
  vi.stubEnv('RYANAI_OWNER_AUTH_USER_ID', '11111111-1111-4111-8111-111111111111');
  vi.stubEnv('RYANAI_OWNER_TITLE', 'Sir G');
  vi.stubEnv('RYANAI_OWNER_LANGUAGE', 've-ZA');
  prismaMock.communicationMessage.create.mockResolvedValue({ id: 'voice-message-1' });
  enqueueInboundCommunicationRun.mockResolvedValue({ runId: 'voice-run-1', status: 'queued', replayed: false, notified: true });
  waitForInboundCommunicationRun.mockResolvedValue({ completed: true, answer: 'RyanAI says hello & welcome' });
  enqueueCommsAssistRun.mockResolvedValue({ runId: 'assist-run-1', status: 'queued' });
  waitForAutonomousTask.mockResolvedValue({ result: 'RyanAI says hello & welcome' });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Twilio inbound SMS retry handling', () => {
  it('persists inbound SMS but suppresses the automatic reply without explicit communications test authorization', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const response = await send('/api/webhooks/twilio/sms', smsUrl, { MessageSid: 'SM-DISABLED', From: '+15555550123', Body: 'Do not auto-reply' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Response/>');
    expect(response.body).not.toContain('<Message>');
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'voice-message-1', ownerUserId: '11111111-1111-4111-8111-111111111111', providerMessageId: 'SM-DISABLED',
    });
    expect(prismaMock.communicationMessage.create).not.toHaveBeenCalled();
  });

  it('returns the cached response without invoking RyanAI for a retried provider event', async () => {
    const payload = { MessageSid: 'SM-duplicate-1', From: '+15555550123', Body: 'Please check my system' };
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      status: 'replied',
      metadata: { reply: 'Certainly, Sir G. Already processed.' },
    });

    const response = await send('/api/webhooks/twilio/sms', smsUrl, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Already processed.');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('requests a provider retry when a newly queued SMS AgentRun is still processing', async () => {
    waitForInboundCommunicationRun.mockResolvedValueOnce({ completed: false });
    const response = await send('/api/webhooks/twilio/sms', smsUrl, {
      MessageSid: 'SM-pending-new-run', From: '+15555550123', Body: 'Please check my system',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ retryable: true });
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'voice-message-1', ownerUserId: '11111111-1111-4111-8111-111111111111', providerMessageId: 'SM-pending-new-run',
    });
  });

  it('requests a provider retry when a duplicate SMS has no linked AgentRun yet', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      id: 'sms-existing-unlinked',
      status: 'processing',
      metadata: null,
      agentRunId: null,
      body: 'Please check my system',
      conversation: { channel: 'sms', ownerUserId: '11111111-1111-4111-8111-111111111111' },
    });

    const response = await send('/api/webhooks/twilio/sms', smsUrl, {
      MessageSid: 'SM-pending-unlinked', From: '+15555550123', Body: 'Please check my system',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ retryable: true });
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
    expect(waitForInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('resumes the existing SMS AgentRun and requests a retry while it remains unfinished', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      id: 'sms-existing-linked',
      status: 'processing',
      metadata: null,
      agentRunId: 'sms-run-existing',
      body: 'Please check my system',
      conversation: { channel: 'sms', ownerUserId: '11111111-1111-4111-8111-111111111111' },
    });
    waitForInboundCommunicationRun.mockResolvedValueOnce({ completed: false });

    const response = await send('/api/webhooks/twilio/sms', smsUrl, {
      MessageSid: 'SM-pending-linked', From: '+15555550123', Body: 'Please check my system',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ retryable: true });
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith('sms-run-existing', '11111111-1111-4111-8111-111111111111');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('returns retryable 503 when durable SMS AgentRun enqueue fails', async () => {
    enqueueInboundCommunicationRun.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await send('/api/webhooks/twilio/sms', smsUrl, {
      MessageSid: 'SM-enqueue-failed', From: '+15555550123', Body: 'Please check my system',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ retryable: true });
    expect(response.body).toContain('provider may retry');
  });
});

describe('Twilio conversational voice webhooks', () => {
  it('rejects forged incoming call webhooks', async () => {
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' }, false);
    expect(response.statusCode).toBe(401);
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('hangs up without speaking when explicit communications test authorization is absent', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA-DISABLED', From: '+15555550123' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Response><Hangup/></Response>');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('answers authenticated incoming calls with a speech gather loop', async () => {
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toContain('This is RyanAI. How may I assist you?');
    expect(response.body).toContain('language="en-ZA"');
    expect(response.body).toContain('<Gather input="speech" language="en-ZA"');
    expect(response.body).toMatch(/Good (morning|afternoon|evening), Sir G\\. Today is .+\\. This is RyanAI\\. How may I assist you\\?/);
    expect(response.body).toContain('Please speak after the tone.');
    expect(response.body).toContain('language="en-ZA" voice="Polly.Ayanda-Neural"');
    expect(response.body).toContain('<Gather input="speech"');
    expect(response.body).toContain(actionUrl);
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('does not generate a voice response without explicit communications test authorization', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const response = await send('/api/webhooks/twilio/voice/respond', actionUrl, { CallSid: 'CA-DISABLED', From: '+15555550123', SpeechResult: 'Please do not reply' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Response><Hangup/></Response>');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('routes each signed speech turn through one durable AgentRun', async () => {
    const turnId = '11111111-1111-4111-8111-111111111111';
    const payload = { CallSid: 'CA123', From: '+15555550123', SpeechResult: 'Please check my system' };
    const response = await send('/api/webhooks/twilio/voice/respond?turnId=' + turnId, actionUrl + '?turnId=' + turnId, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Certainly, Sir G. RyanAI says hello &amp; welcome');
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'voice-message-1', ownerUserId: '11111111-1111-4111-8111-111111111111', providerMessageId: 'voice:CA123:' + turnId,
    });
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith('voice-run-1', '11111111-1111-4111-8111-111111111111');
  });

  it('replays the persisted answer for a duplicate signed voice turn without enqueueing another run', async () => {
    const turnId = '33333333-3333-4333-8333-333333333333';
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      id: 'voice-message-existing',
      status: 'replied',
      metadata: { reply: 'That turn was already answered.' },
      agentRunId: 'voice-run-existing',
    });
    const response = await send(
      '/api/webhooks/twilio/voice/respond?turnId=' + turnId,
      actionUrl + '?turnId=' + turnId,
      { CallSid: 'CA123', From: '+15555550123', SpeechResult: 'Please check my system' },
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('That turn was already answered.');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('accepts the owner as the To party on outbound AI voice calls', async () => {
    const turnId = '22222222-2222-4222-8222-222222222222';
    const payload = { CallSid: 'CAOUT123', From: '+15555550000', To: '+15555550123', SpeechResult: 'What is the system status?' };
    const response = await send('/api/webhooks/twilio/voice/respond?turnId=' + turnId, actionUrl + '?turnId=' + turnId, payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Certainly, Sir G. RyanAI says hello &amp; welcome');
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledWith(expect.objectContaining({ providerMessageId: 'voice:CAOUT123:' + turnId }));
  });

  it('fails closed when the signature token is not configured', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    const response = await send('/api/webhooks/twilio/voice', voiceUrl, { CallSid: 'CA123', From: '+15555550123' });
    expect(response.statusCode).toBe(503);
  });
});


// Delivery status callback behavior is covered by twilioStatusCallback.test.ts.

describe('Comms conversation ownership', () => {
  it('never assigns legacy ownerless conversations to the requesting owner during a read', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({ method: 'GET', url: '/api/comms/conversations' });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.communicationConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: '11111111-1111-4111-8111-111111111111' },
    }));
    expect(prismaMock.communicationConversation.updateMany).not.toHaveBeenCalled();
  });
});

describe('Comms conversation intelligence', () => {
  it('requires a request idempotency key before queuing Comms assist', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/assist',
      payload: { operation: 'summarize', conversationId: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11' },
    });
    expect(response.statusCode).toBe(400);
    expect(enqueueCommsAssistRun).not.toHaveBeenCalled();
  });

  it('keeps analysis owner-scoped and never dispatches a provider request', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/assist',
      payload: { operation: 'summarize', conversationId: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11', idempotencyKey: 'assist-request-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      operation: 'summarize', output: 'RyanAI says hello & welcome', sourceMessageCount: 1, runId: 'assist-run-1',
    });
    expect(enqueueCommsAssistRun).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'assist-request-key-0001',
    }));
    expect(waitForAutonomousTask).toHaveBeenCalledExactlyOnceWith('assist-run-1', '11111111-1111-4111-8111-111111111111', 8_000);
    expect(prismaMock.communicationMessage.create).not.toHaveBeenCalled();
  });
});

describe('private RyanAI in-app Comms chat', () => {
  it('accepts an owner message, creates one durable AgentRun and persists RyanAI reply even when provider Comms is disabled', async () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);
    prismaMock.communicationMessage.create.mockResolvedValueOnce({ id: 'in-app-message-1' });
    prismaMock.communicationMessage.findUnique
      .mockResolvedValueOnce({ metadata: { source: 'comms_in_app' }, conversationId: 'conversation-1' })
      .mockResolvedValueOnce({
        id: 'in-app-reply-1',
        body: 'Certainly, Sir G. Your Comms chat is working.',
        status: 'response_generated',
        createdAt: new Date('2026-11-21T20:00:00.000Z'),
      });
    enqueueInboundCommunicationRun.mockResolvedValueOnce({
      runId: 'in-app-run-1', status: 'queued', replayed: false, notified: true,
    });
    waitForInboundCommunicationRun.mockResolvedValueOnce({
      completed: true, answer: 'Your Comms chat is working.',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/chat',
      payload: { message: 'RyanAI, can you hear me?', idempotencyKey: 'in-app-chat-request-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      messageId: 'in-app-message-1',
      runId: 'in-app-run-1',
      status: 'replied',
      reply: { id: 'in-app-reply-1', status: 'response_generated' },
    });
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'in-app-message-1',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      providerMessageId: 'inapp:11111111-1111-4111-8111-111111111111:in-app-chat-request-0001',
    });
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith('in-app-run-1', '11111111-1111-4111-8111-111111111111', 8_000);
    expect(prismaMock.communicationMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { providerMessageId: 'inapp-reply:in-app-message-1' },
    }));
  });

  it('does not expose the private chat endpoint to non-owners', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: 'other-user', role: 'user', isOwner: false };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/chat',
      payload: { message: 'Hello', idempotencyKey: 'in-app-chat-request-0002' },
    });

    expect(response.statusCode).toBe(403);
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('returns a processing state rather than fabricating a reply when the AgentRun is not finished', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);
    prismaMock.communicationMessage.create.mockResolvedValueOnce({ id: 'in-app-message-2' });
    enqueueInboundCommunicationRun.mockResolvedValueOnce({ runId: 'in-app-run-1', status: 'queued', replayed: false, notified: true });
    waitForInboundCommunicationRun.mockResolvedValueOnce({ completed: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/chat',
      payload: { message: 'Check my request', idempotencyKey: 'in-app-chat-request-0003' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ messageId: 'in-app-message-2', runId: 'in-app-run-1', status: 'processing' });
    expect(prismaMock.communicationMessage.upsert).not.toHaveBeenCalled();
  });
});

describe('outbound Comms request validation', () => {
  it('blocks provider dispatch when explicit test authorization is absent', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const response = await send('/api/comms/send', '', {});
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('owner explicitly authorizes a communications test');
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('blocks outbound dispatch when the recipient has not been verified', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC00000000000000000000000000000000');
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+15555550000');
    vi.stubEnv('TWILIO_STATUS_CALLBACK_URL', 'https://ryanai.example.test/api/webhooks/twilio/status');
    vi.stubEnv('TWILIO_STATUS_WEBHOOK_URL', 'https://ryanai.example.test/api/webhooks/twilio/status');
    const response = await send('/api/comms/send', '', {
      channel: 'sms',
      recipient: '+15555550123',
      message: 'This must not be sent',
      idempotencyKey: 'comms-test-key-0001',
      approvalId: '00000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('verified owner destination');
    expect(prismaMock.communicationConversation.upsert).not.toHaveBeenCalled();
  });

  it('requires an idempotency key before reserving or sending a provider request', async () => {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const response = await app.inject({
      method: 'POST',
      url: '/api/comms/send',
      payload: { channel: 'whatsapp', recipient: '+15555550123', message: 'Hello Sir' },
    });

    expect(response.statusCode).toBe(400);
    expect(prismaMock.communicationConversation.upsert).not.toHaveBeenCalled();
  });
});

describe('Comms feature gates', () => {
  it('keeps workspace history and status routes available when outbound communications are disabled', async () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('authUser', null);
    app.addHook('preHandler', async (request) => {
      request.authUser = { id: '11111111-1111-4111-8111-111111111111', role: 'user', isOwner: true };
    });
    app.decorate('prisma', prismaMock as never);
    await app.register(commsPlugin);

    const [history, status] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/comms/conversations' }),
      app.inject({ method: 'GET', url: '/api/comms/status' }),
    ]);
    expect(history.statusCode).toBe(200);
    expect(history.json().conversations).toEqual([]);
    expect(status.statusCode).toBe(200);
    expect(status.json().enabled).toBe(false);
  });

  it('blocks outbound dispatch with a clear 503 while keeping the route registered', async () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    const response = await send('/api/comms/send', '', {});
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('history and workspace access remain available');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('blocks attachment upload preparation until the scanner and attachment flag are enabled', async () => {
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', 'false');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'true');
    const response = await send('/api/comms/attachments/prepare', '', {});
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Communication attachments are disabled.' });
  });
});
