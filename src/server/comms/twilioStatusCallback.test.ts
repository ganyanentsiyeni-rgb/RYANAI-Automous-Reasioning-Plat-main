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
  communicationMessage: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'message-1',
      direction: 'outbound',
      conversation: { channel: 'sms' },
    }),
    update: vi.fn().mockResolvedValue({}),
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
    delete process.env.TWILIO_AUTH_TOKEN;
    const response = await post({ MessageSid: sid, MessageStatus: 'delivered' }, { authToken: null });
    expect(response.statusCode).toBe(503);
  });

  it('rejects a forged Twilio signature', async () => {
    const response = await post({ MessageSid: sid, MessageStatus: 'delivered' }, { signature: 'forged' });
    expect(response.statusCode).toBe(401);
    expect(prisma.communicationMessage.update).not.toHaveBeenCalled();
  });

  it('persists an authenticated receipt and forwards metadata-only event to PA', async () => {
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
      expect(prisma.communicationMessage.update).toHaveBeenCalledWith({
        where: { id: 'message-1' }, data: { status: 'delivered' },
      });
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0][0]).toMatchObject({
        eventType: 'comms.delivery.receipt',
        source: 'ryanai-comms',
        channel: 'sms',
        state: 'delivered',
        commitSha,
      });
      expect(JSON.stringify(received.mock.calls[0][0])).not.toContain('+15555550123');
    } finally {
      ryanAIPaEventBridge.off('event', received);
    }
  });

  it('does not mark an unknown provider ID delivered', async () => {
    prisma.communicationMessage.findUnique.mockResolvedValueOnce(null);
    const response = await post({ MessageSid: sid, MessageStatus: 'delivered' });
    expect(response.statusCode).toBe(503);
    expect(prisma.communicationMessage.update).not.toHaveBeenCalled();
  });
});
