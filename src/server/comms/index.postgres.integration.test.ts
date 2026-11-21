import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import twilio from 'twilio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { commsPlugin } from './index.js';
import { twilioStatusCallbackPlugin } from './twilioStatusCallback.js';
import { installAuthentication } from '../routes/auth.js';

vi.mock('../../agent/approvalEngine.js', () => ({
  humanInTheLoopAgent: { invoke: vi.fn() },
}));

const enabled = process.env.RUN_COMMS_POSTGRES_INTEGRATION === 'true';
const integration = enabled ? describe : describe.skip;
const prisma = new PrismaClient();
const authToken = 'ryanai-local-postgres-callback-test-token';
const callbackUrl = 'https://ryanai.example.test/api/webhooks/twilio/status';
// Twilio SIDs are a two-letter prefix followed by exactly 32 hexadecimal characters.
const providerMessageId = `SM${randomUUID().replaceAll('-', '')}`;
const conversationId = randomUUID();
const messageId = randomUUID();
let app: FastifyInstance;
let createdApprovalFixture = false;

integration('Comms Twilio status callback with disposable PostgreSQL', () => {
  beforeAll(async () => {
    process.env.COMMUNICATIONS_ENABLED = 'true';
    process.env.TWILIO_AUTH_TOKEN = authToken;
    process.env.TWILIO_STATUS_WEBHOOK_URL = callbackUrl;
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.communication_messages
        ADD COLUMN IF NOT EXISTS agent_run_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS communication_messages_agent_run_id_key
        ON public.communication_messages (agent_run_id);
    `);

    // The callback also updates the optional outbound-approval ledger. This
    // integration workflow intentionally does not apply that production
    // migration, so provide only the columns exercised by the callback.
    const approvalTable = await prisma.$queryRawUnsafe<Array<{ table_name: string | null }>>(
      "SELECT to_regclass('public.comms_send_approvals')::text AS table_name",
    );
    if (!approvalTable[0]?.table_name) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE public.comms_send_approvals (
          provider_message_id text,
          provider_status text,
          status text,
          updated_at timestamptz
        )
      `);
      createdApprovalFixture = true;
    }

    await prisma.communicationConversation.create({
      data: {
        id: conversationId,
        channel: 'sms',
        externalAddress: '+15555550123',
      },
    });
    await prisma.communicationMessage.create({
      data: {
        id: messageId,
        conversationId,
        direction: 'outbound',
        body: 'Synthetic callback fixture; no provider send is performed.',
        providerMessageId,
        status: 'accepted',
        metadata: { integrationFixture: true, preservedValue: 'before-callback' },
      },
    });

    app = Fastify();
    installAuthentication(app);
    app.decorate('prisma', prisma as never);
    await app.register(commsPlugin);
    await app.register(twilioStatusCallbackPlugin);
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.communicationMessage.deleteMany({ where: { id: messageId } });
    await prisma.communicationConversation.deleteMany({ where: { id: conversationId } });
    if (createdApprovalFixture) {
      await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS public.comms_send_approvals');
    }
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('rejects a forged signature and leaves the persisted message unchanged', async () => {
    const payload = { MessageSid: providerMessageId, MessageStatus: 'delivered', ErrorCode: '' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/twilio/status',
      payload: new URLSearchParams(payload).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid-synthetic-signature',
      },
    });

    expect(response.statusCode).toBe(401);
    const stored = await prisma.communicationMessage.findUnique({
      where: { id: messageId },
      select: { status: true, metadata: true },
    });
    expect(stored?.status).toBe('accepted');
    expect(stored?.metadata).toEqual({ integrationFixture: true, preservedValue: 'before-callback' });
  });

  it('persists a valid signed delivery callback to PostgreSQL without replacing metadata', async () => {
    const payload = { MessageSid: providerMessageId, MessageStatus: 'delivered', ErrorCode: '' };
    const signature = twilio.getExpectedTwilioSignature(authToken, callbackUrl, payload);
    const sendCallback = () => app.inject({
      method: 'POST',
      url: '/api/webhooks/twilio/status',
      payload: new URLSearchParams(payload).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature,
      },
    });

    const first = await sendCallback();
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ accepted: true, state: 'delivered' });

    const stored = await prisma.communicationMessage.findUnique({
      where: { id: messageId },
      select: { status: true, providerMessageId: true, metadata: true },
    });
    expect(stored).toEqual({
      status: 'delivered',
      providerMessageId,
      metadata: { integrationFixture: true, preservedValue: 'before-callback' },
    });

    const retry = await sendCallback();
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toEqual({ accepted: true, state: 'delivered' });
    const afterRetry = await prisma.communicationMessage.findUnique({
      where: { id: messageId },
      select: { status: true, providerMessageId: true, metadata: true },
    });
    expect(afterRetry).toEqual(stored);
  });
});
