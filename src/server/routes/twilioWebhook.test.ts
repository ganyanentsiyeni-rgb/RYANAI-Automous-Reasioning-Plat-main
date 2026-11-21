import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { twilioWebhookPlugin } from './twilioWebhook.js';
import { installAuthentication } from './auth.js';

const { invoke, enqueueInboundCommunicationRun, waitForInboundCommunicationRun, decideCommsApprovalFromOwner, recordOwnerGitHubPrReviewDecision, prismaMock } = vi.hoisted(() => ({
  decideCommsApprovalFromOwner: vi.fn(),
  recordOwnerGitHubPrReviewDecision: vi.fn(),
  invoke: vi.fn(),
  enqueueInboundCommunicationRun: vi.fn(),
  waitForInboundCommunicationRun: vi.fn(),
  prismaMock: {
    communicationConversation: { upsert: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
    communicationMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'message-1' }),
    },
  },
}));
vi.mock('../../agent/approvalEngine.js', () => ({
  humanInTheLoopAgent: { invoke },
}));
vi.mock('../comms/agentRuns.js', () => ({
  enqueueInboundCommunicationRun,
  waitForInboundCommunicationRun,
}));
vi.mock('../comms/authorization.js', () => ({ decideCommsApprovalFromOwner }));
vi.mock('../githubPrReviewApproval.js', () => ({ recordOwnerGitHubPrReviewDecision }));
const applications: FastifyInstance[] = [];
const token = 'synthetic-twilio-auth-token';
const webhookUrl = 'https://app.example.test/api/webhooks/twilio/whatsapp';
const body = { From: 'whatsapp:+15555550123', Body: 'Please help', MessageSid: 'SM123' };

async function sendWebhook(signature?: string, payload = body, host?: string, path = '/api/webhooks/twilio/whatsapp') {
  const app = Fastify();
  applications.push(app);
  installAuthentication(app);
  app.decorate('prisma', prismaMock as never);
  await app.register(twilioWebhookPlugin);
  return app.inject({
    method: 'POST',
    url: path,
    payload: new URLSearchParams(payload).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'x-twilio-signature': signature } : {}),
      ...(host ? { host } : {}),
    },
  });
}

beforeEach(() => {
  vi.stubEnv('COMMUNICATIONS_ENABLED', 'true');
  vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'true');
  prismaMock.communicationConversation.upsert.mockResolvedValue({ id: 'conversation-1' });
  prismaMock.communicationMessage.findUnique.mockResolvedValue(null);
  prismaMock.communicationMessage.upsert.mockResolvedValue({});
  prismaMock.communicationMessage.update.mockResolvedValue({});
  prismaMock.communicationMessage.create.mockResolvedValue({});
  vi.stubEnv('TWILIO_AUTH_TOKEN', token);
  vi.stubEnv('TWILIO_WHATSAPP_WEBHOOK_URL', webhookUrl);
  vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
  vi.stubEnv('RYANAI_OWNER_AUTH_USER_ID', '11111111-1111-4111-8111-111111111111');
  decideCommsApprovalFromOwner.mockReset();
  recordOwnerGitHubPrReviewDecision.mockReset();
  vi.stubEnv('RYANAI_OWNER_LANGUAGE', 've-ZA');
  invoke.mockResolvedValue({
    messages: [{ content: 'Approved <reply> & ready' }],
  });
  enqueueInboundCommunicationRun.mockResolvedValue({ runId: 'run-1', status: 'queued', replayed: false, notified: true });
  waitForInboundCommunicationRun.mockResolvedValue({ completed: true, answer: 'Approved <reply> & ready' });
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('Twilio webhook provider authentication', () => {
  it.each(['TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_WEBHOOK_URL'])(
    'fails closed without %s',
    async (name) => {
      vi.stubEnv(name, '');
      expect((await sendWebhook()).statusCode).toBe(503);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'forged-signature'])(
    'rejects missing or forged signatures (%s)',
    async (signature) => {
      expect((await sendWebhook(signature)).statusCode).toBe(401);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('rejects tampered signed message content', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      webhookUrl,
      body,
    );
    expect(
      (
        await sendWebhook(signature, {
          ...body,
          Body: 'Perform different action',
        })
      ).statusCode,
    ).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the configured external URL rather than a forged Host header', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      'https://attacker.example/api/webhooks/twilio/whatsapp',
      body,
    );
    expect(
      (await sendWebhook(signature, body, 'attacker.example')).statusCode,
    ).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a validly signed message from a non-owner number', async () => {
    const other = { ...body, From: 'whatsapp:+15555550999' };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, other);
    const response = await sendWebhook(signature, other);
    expect(response.statusCode).toBe(403);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not invoke RyanAI again when Twilio retries an already-claimed message', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      status: 'replied',
      metadata: { reply: 'Certainly, Sir G. This was already handled.' },
    });
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('This was already handled.');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stores an authentic inbound WhatsApp message but suppresses the auto-reply until explicitly authorized', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toContain('<Response/>');
    expect(response.body).not.toContain('<Message>');
    expect(prismaMock.communicationMessage.update).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM123' },
      data: { status: 'received', metadata: { mediaCount: 0, replySuppressed: true } },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('records an explicit owner approval received through signed WhatsApp even when outbound test replies are disabled', async () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'false');
    const approvalId = '22222222-2222-4222-8222-222222222222';
    decideCommsApprovalFromOwner.mockResolvedValue({ approvalId, status: 'approved' });
    const payload = { ...body, Body: `APPROVE ${approvalId}` };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, payload);

    const response = await sendWebhook(signature, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Response/>');
    expect(response.body).not.toContain('<Message>');
    expect(decideCommsApprovalFromOwner).toHaveBeenCalledExactlyOnceWith(
      prismaMock,
      '11111111-1111-4111-8111-111111111111',
      approvalId,
      'approve',
    );
    expect(prismaMock.communicationMessage.update).toHaveBeenCalledWith({
      where: { providerMessageId: payload.MessageSid },
      data: {
        status: 'received',
        metadata: {
          approvalId,
          approvalDecision: 'approve',
          approvalStatus: 'approved',
          replySuppressed: true,
        },
      },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('records an exact-SHA GitHub PR approval through the signed owner WhatsApp route without submitting a review', async () => {
    const approvalId = '44444444-4444-4444-8444-444444444444';
    const sha = 'a'.repeat(40);
    recordOwnerGitHubPrReviewDecision.mockResolvedValue({
      id: approvalId, pull_request_number: 624, expected_head_sha: sha, status: 'approved',
    });
    const payload = { ...body, Body: `GITHUB APPROVE ${approvalId} ${sha}` };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, payload);

    const response = await sendWebhook(signature, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('records consent only; no GitHub review has been submitted');
    expect(recordOwnerGitHubPrReviewDecision).toHaveBeenCalledExactlyOnceWith(
      prismaMock,
      expect.objectContaining({
        ownerUserId: '11111111-1111-4111-8111-111111111111',
        approvalId,
        expectedHeadSha: sha,
        inboundMessageSid: payload.MessageSid,
        decision: 'approve',
      }),
    );
    expect(decideCommsApprovalFromOwner).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects malformed GitHub approval commands without invoking the agent or Comms approval path', async () => {
    const payload = { ...body, Body: 'GITHUB APPROVE 44444444' };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, payload);

    const response = await sendWebhook(signature, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('GITHUB APPROVE');
    expect(recordOwnerGitHubPrReviewDecision).not.toHaveBeenCalled();
    expect(decideCommsApprovalFromOwner).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('records an explicit owner rejection and never invokes the agent', async () => {
    const approvalId = '33333333-3333-4333-8333-333333333333';
    decideCommsApprovalFromOwner.mockResolvedValue({ approvalId, status: 'rejected' });
    const payload = { ...body, Body: `REJECT ${approvalId}` };
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, payload);

    const response = await sendWebhook(signature, payload);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('recorded your rejection');
    expect(decideCommsApprovalFromOwner).toHaveBeenCalledExactlyOnceWith(
      prismaMock,
      '11111111-1111-4111-8111-111111111111',
      approvalId,
      'reject',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('accepts an authentic provider request without a user bearer and escapes the reply XML', async () => {
    const signature = twilio.getExpectedTwilioSignature(
      token,
      webhookUrl,
      body,
    );
    const response = await sendWebhook(signature);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/xml');
    expect(response.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Certainly, Sir G. Approved &lt;reply&gt; &amp; ready</Message></Response>',
    );
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'message-1',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      providerMessageId: 'SM123',
    });
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith(
      'run-1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it('returns a retryable non-2xx response when durable AgentRun enqueue fails', async () => {
    enqueueInboundCommunicationRun.mockRejectedValueOnce(new Error('database unavailable'));
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toContain('provider may retry');
    expect(response.body).not.toContain('<Response');
    expect(prismaMock.communicationMessage.create).toHaveBeenCalled();
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'message-1',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      providerMessageId: 'SM123',
    });
  });

  it('returns a retryable non-2xx response when inbound message persistence fails', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce(new Error('postgres unavailable'));
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('provider may retry');
    expect(enqueueInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('keeps a claimed message retryable when no AgentRun was linked before a prior failure', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      id: 'message-1',
      status: 'processing',
      metadata: null,
      createdAt: new Date(),
      agentRunId: null,
    });
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('durable RyanAI run is not linked');
    expect(waitForInboundCommunicationRun).not.toHaveBeenCalled();
  });

  it('keeps a linked but unfinished AgentRun retryable instead of acknowledging an empty reply', async () => {
    prismaMock.communicationMessage.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.communicationMessage.findUnique.mockResolvedValueOnce({
      id: 'message-1',
      status: 'processing',
      metadata: null,
      createdAt: new Date(),
      agentRunId: 'run-1',
    });
    waitForInboundCommunicationRun.mockResolvedValueOnce({ completed: false });
    const signature = twilio.getExpectedTwilioSignature(token, webhookUrl, body);

    const response = await sendWebhook(signature);

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('durable RyanAI run is still processing');
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith(
      'run-1',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('does not register the legacy webhook path', async () => {
    const response = await sendWebhook(undefined, body, undefined, '/webhooks/twilio/whatsapp');
    expect(response.statusCode).toBe(404);
  });
});

describe('Twilio communications feature gate', () => {
  it('does not register provider webhooks when communications are disabled', async () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    const response = await sendWebhook();
    expect(response.statusCode).toBe(404);
    expect(invoke).not.toHaveBeenCalled();
  });
});
