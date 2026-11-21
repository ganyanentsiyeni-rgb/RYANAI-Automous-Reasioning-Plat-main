import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistCommsConversation, getCommsConversations, getCommsStatus, sendCommsMessage, sendInAppCommsMessage } from './commsApi';

const request = vi.hoisted(() => vi.fn());
vi.mock('./authenticatedFetch', () => ({ authenticatedFetch: request }));

afterEach(() => request.mockReset());

describe('Comms API client', () => {
  it('reads configuration snapshot without claiming provider connectivity', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      status: 'configuration_snapshot', channels: { whatsapp: true }, note: 'Configuration only',
    }), { status: 200 }));
    await expect(getCommsStatus('synthetic-user-a')).resolves.toMatchObject({
      status: 'configuration_snapshot', channels: { whatsapp: true },
    });
    expect(request).toHaveBeenCalledWith('/api/comms/status', undefined, 'synthetic-user-a');
  });

  it('clamps conversation history requests and returns server messages', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    await expect(getCommsConversations('synthetic-user-a', 1000)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith('/api/comms/conversations?limit=100', undefined, 'synthetic-user-a');
  });

  it('uses the default conversation history limit for non-finite input', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
    await expect(getCommsConversations('synthetic-user-a', Number.NaN)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith('/api/comms/conversations?limit=50', undefined, 'synthetic-user-a');
  });

  it('sends private RyanAI chat through the authenticated AgentRun endpoint', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      messageId: 'in-app-message-1',
      runId: 'in-app-run-1',
      status: 'replied',
      reply: { id: 'in-app-reply-1', body: 'I can hear you.', status: 'response_generated', createdAt: '2026-11-21T20:00:00.000Z' },
    }), { status: 200 }));
    await expect(sendInAppCommsMessage({
      message: 'RyanAI, can you hear me?',
      idempotencyKey: 'in-app-chat-request-0001',
    }, 'synthetic-user-a')).resolves.toMatchObject({
      messageId: 'in-app-message-1',
      status: 'replied',
      reply: { body: 'I can hear you.' },
    });
    expect(request).toHaveBeenCalledWith('/api/comms/chat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'RyanAI, can you hear me?', idempotencyKey: 'in-app-chat-request-0001' }),
    }), 'synthetic-user-a');
  });

  it('automatically supplies the idempotency key required by Comms assist', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      operation: 'summarize', output: 'Summary', sourceMessageCount: 1,
    }), { status: 200 }));
    await assistCommsConversation({
      operation: 'summarize',
      conversationId: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11',
    }, 'synthetic-user-a');
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.operation).toBe('summarize');
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('sends through the authenticated API without exposing provider keys', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      success: true, channel: 'whatsapp', providerId: 'SM-test', status: 'accepted',
    }), { status: 202 }));
    await expect(sendCommsMessage({
      channel: 'whatsapp', recipient: '+27710000000', message: 'Hello', idempotencyKey: 'test-request-key-0001',
    }, 'synthetic-user-a')).resolves.toMatchObject({ success: true, providerId: 'SM-test' });
    expect(request).toHaveBeenCalledWith('/api/comms/send', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ channel: 'whatsapp', recipient: '+27710000000', message: 'Hello', idempotencyKey: 'test-request-key-0001' }),
    }), 'synthetic-user-a');
  });

  it('surfaces server authorization errors instead of pretending a send succeeded', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: 'Owner access is required.' }), { status: 403 }));
    await expect(getCommsStatus('synthetic-user-a')).rejects.toThrow('Owner access is required.');
  });
});
