import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { commsPlugin } from './index.js';

const {
  claimInboundCommunication,
  enqueueInboundCommunicationRun,
  waitForInboundCommunicationRun,
} = vi.hoisted(() => ({
  claimInboundCommunication: vi.fn(),
  enqueueInboundCommunicationRun: vi.fn(),
  waitForInboundCommunicationRun: vi.fn(),
}));

const resendMock = vi.hoisted(() => ({
  verify: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
}));

vi.mock('./history.js', () => ({
  claimInboundCommunication,
  recordCommunication: vi.fn(),
  beginOutboundCommunication: vi.fn(),
  completeOutboundCommunication: vi.fn(),
  OutboundIdempotencyConflictError: class extends Error {},
  prepareOutboundCommunication: vi.fn(),
}));

vi.mock('./agentRuns.js', () => ({
  enqueueInboundCommunicationRun,
  waitForInboundCommunicationRun,
  enqueueCommsAssistRun: vi.fn(),
}));

vi.mock('./attachments.js', () => ({
  getOwnerInboundUserId: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
  areCommunicationAttachmentsEnabled: vi.fn(() => false),
  downloadResendMedia: vi.fn(),
  storeInboundCommsAttachment: vi.fn(),
  createCommsUploadIntents: vi.fn(),
  createCommsStorageAdmin: vi.fn(),
  cleanCommsAttachmentUrls: vi.fn(),
  getCommsAttachmentScanStates: vi.fn(),
  getCommsAttachmentStatuses: vi.fn(),
  storeTwilioMediaForCommunication: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    webhooks = { verify: resendMock.verify };
    emails = {
      receiving: {
        get: resendMock.get,
        attachments: { list: resendMock.list },
      },
    };
  },
}));

const prismaMock = {
  communicationMessage: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  communicationConversation: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
};

const app = Fastify();

beforeEach(async () => {
  vi.stubEnv('COMMUNICATIONS_ENABLED', 'true');
  vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
  vi.stubEnv('RESEND_WEBHOOK_SECRET', 'test-webhook-secret');
  vi.stubEnv('RYANAI_OWNER_EMAIL', 'owner@example.com');
  vi.stubEnv('RYANAI_OWNER_AUTH_USER_ID', '11111111-1111-4111-8111-111111111111');

  resendMock.verify.mockReturnValue({
    type: 'email.received',
    data: { email_id: 're_123', from: 'owner@example.com' },
  });
  resendMock.get.mockResolvedValue({
    data: {
      id: 're_123',
      from: 'owner@example.com',
      subject: 'RyanAI test',
      text: 'Please check my system',
      html: null,
    },
  });
  resendMock.list.mockResolvedValue({ data: { data: [], has_more: false } });

  claimInboundCommunication.mockResolvedValue({
    claimed: true,
    messageId: 'email-message-1',
  });
  enqueueInboundCommunicationRun.mockResolvedValue({
    runId: 'email-run-1',
    status: 'queued',
    replayed: false,
    notified: true,
  });
  waitForInboundCommunicationRun.mockResolvedValue({ completed: false });

  prismaMock.communicationMessage.findUnique.mockResolvedValue({
    id: 'email-message-1',
    conversationId: 'email-conversation-1',
  });

  app.decorate('prisma', prismaMock as never);
  await app.register(commsPlugin);
});

afterEach(async () => {
  await app.close();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('Resend inbound email durable AgentRun routing', () => {
  it('links a fresh signed owner email to exactly one durable AgentRun and requests safe provider retry while unfinished', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/resend/inbound',
      payload: 'signed-resend-payload',
      headers: {
        'svix-id': 'msg_123',
        'svix-timestamp': '1764093600',
        'svix-signature': 'v1,test-signature',
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      received: true,
      processing: true,
      retryable: true,
      runId: 'email-run-1',
    });

    expect(resendMock.verify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      payload: 'signed-resend-payload',
      webhookSecret: 'test-webhook-secret',
    }));
    expect(claimInboundCommunication).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      channel: 'email',
      externalAddress: 'owner@example.com',
      body: 'Please check my system',
      providerMessageId: 're_123',
      status: 'processing',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
    }));
    expect(enqueueInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith({
      messageId: 'email-message-1',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      providerMessageId: 're_123',
    });
    expect(waitForInboundCommunicationRun).toHaveBeenCalledExactlyOnceWith(
      'email-run-1',
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
