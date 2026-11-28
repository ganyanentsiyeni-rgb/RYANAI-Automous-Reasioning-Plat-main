import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { twilioStatusCallbackPlugin, mapTwilioDeliveryState } from './twilioStatusCallback.js';
import { ryanAIPaEventBridge } from '../selfPatch/ryanAIPaEventBridge.js';

const token = 'twilio-status-test-auth-token';
const url = 'https://api.example.test/api/webhooks/twilio/status';
const sid = 'SM' + 'a'.repeat(32);
const commitSha = 'b'.repeat(40);
const apps: FastifyInstance[] = [];
const prisma = {
  outboundCommsDispatch: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'dispatch-1',
      communicationMessageId: 'message-1',
      providerMessageId: sid,
      state: 'accepted',
      agentRunId: 'run-1',
      channel: 'sms',
    }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  commsDeliveryReceipt: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
  },
  $executeRawUnsafe: vi.fn().mockResolvedValue(1),
};

async function post(body: Record<string, string>, overrides: { signature?: string; configuredUrl?: string; authToken?: string | null } = {}) {
  if (overrides.authToken === null) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = overrides.authToken ?? token;
  process.env.TWILIO_STATUS_WEBHOOK_URL = overrides.configuredUrl ?? url;
  process.env.TWILIO_ACCOUNT_SID = 'AC' + 'c'.repeat(32);
  process.env.VERCEL_GIT_COMMIT_SHA = commitSha;
  const signature = overrides.signature ?? twilio.getExpectedTwilioSignature(token, url, body);
  const app = Fastify();
  apps.push(app);
  app.decorate('prisma', prisma as never);
  await app.register(twilioStatusCallbackPlugin);
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/twilio/status',
    payload: new URLSearchParams(body).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_STATUS_WEBHOOK_URL;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  vi.clearAllMocks();
});

describe('Twilio delivery status callback', () => {
  it('maps only messaging delivered to delivered; voice completion is not delivery proof', () => {
    expect(mapTwilioDeliveryState('sms', 'delivered')).toBe('delivered');
    expect(mapTwilioDeliveryState('voice', 'completed')).toBe('accepted_by_provider');
    expect(mapTwilioDeliveryState('whatsapp', 'undelivered')).toBe('failed');
    expect(mapTwilioDeliveryState('sms', 'mystery')).toBe('unknown');
  });

  it('rejects a missing authentication configuration', async () => {
    const response = await post({ MessageSid: sid, MessageStatus: 'delivered' }, { authToken: null, configuredUrl: '' });
    expect(response.statusCode).toBe(503);
  });

  it('rejects a forged Twilio signature before touching the dispatch store', async () => {
    const response = await post({ MessageSid: sid, MessageStatus: 'delivered' }, { signature: 'forged' });
    expect(response.statusCode).toBe(401);
    expect(prisma.outboundCommsDispatch.findUnique).not.toHaveBeenCalled();
    expect(prisma.commsDeliveryReceipt.create).not.toHaveBeenCalled();
  });

  it('appends an authenticated receipt, advances only dispatch state, and forwards metadata-only PA evidence', async () => {
    const received = vi.fn();
    ryanAIPaEventBridge.on('event', received);
    const body = {
      AccountSid: 'AC' + 'c'.repeat(32),
      MessageSid: sid,
      MessageStatus: 'delivered',
      To: '+15555550123',
      From: '+15555550124',
    };
    try {
      const response = await post(body);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: true, state: 'delivered' });
      expect(prisma.commsDeliveryReceipt.create).toHaveBeenCalledTimes(1);
      const approvalUpdate = prisma.$executeRawUnsafe.mock.calls[0][0] as string;
      expect(approvalUpdate).toContain('public.comms_delivery_receipts');
      expect(approvalUpdate).toContain('ORDER BY occurred_at DESC, created_at DESC');
      expect(approvalUpdate).toContain("status IN ('dispatching', 'accepted', 'unknown', 'failed')");
      expect(prisma.outboundCommsDispatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'dispatch-1', state: { in: expect.arrayContaining(['accepted']) } },
        data: expect.objectContaining({ state: 'delivered' }),
      }));
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0][0]).toMatchObject({
        eventId: '11111111-1111-4111-8111-111111111111',
        eventType: 'comms.delivery.receipt',
        source: 'ryanai-comms',
        channel: 'sms',
        state: 'delivered',
        commitSha,
      });
      expect(JSON.stringify(received.mock.calls[0][0])).not.toContain('+15555550123');
      expect(JSON.stringify(received.mock.calls[0][0])).not.toContain('+15555550124');
    } finally {
      ryanAIPaEventBridge.off('event', received);
    }
  });

  it('returns retryable when the governed dispatch is not committed yet', async () => {
    prisma.outboundCommsDispatch.findUnique.mockResolvedValueOnce(null);
    const response = await post({ AccountSid: 'AC' + 'c'.repeat(32), MessageSid: sid, MessageStatus: 'delivered' });
    expect(response.statusCode).toBe(503);
    expect(prisma.commsDeliveryReceipt.create).not.toHaveBeenCalled();
  });

  it('deduplicates an authenticated replay without creating a second receipt', async () => {
    prisma.commsDeliveryReceipt.findUnique.mockResolvedValueOnce({ id: '11111111-1111-4111-8111-111111111111' });
    const response = await post({ AccountSid: 'AC' + 'c'.repeat(32), MessageSid: sid, MessageStatus: 'delivered' });
    expect(response.statusCode).toBe(202);
    expect(prisma.commsDeliveryReceipt.create).not.toHaveBeenCalled();
  });

  it('reuses the immutable receipt ID as the PA event ID on callback replay', async () => {
    const received = vi.fn();
    ryanAIPaEventBridge.on('event', received);
    const body = {
      AccountSid: 'AC' + 'c'.repeat(32),
      MessageSid: sid,
      MessageStatus: 'delivered',
    };
    try {
      const first = await post(body);
      prisma.commsDeliveryReceipt.findUnique.mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
      });
      const replay = await post(body);
      expect(first.statusCode).toBe(202);
      expect(replay.statusCode).toBe(202);
      expect(received).toHaveBeenCalledTimes(2);
      expect(received.mock.calls[0][0].eventId).toBe('11111111-1111-4111-8111-111111111111');
      expect(received.mock.calls[1][0].eventId).toBe(received.mock.calls[0][0].eventId);
    } finally {
      ryanAIPaEventBridge.off('event', received);
    }
  });
});
