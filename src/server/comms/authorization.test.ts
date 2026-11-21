import { describe, expect, it, vi } from 'vitest';
import {
  assertCommsActionAuthorized,
  buildCommsActionPayload,
  claimCommsAction,
  decideCommsApprovalFromOwner,
  hashCommsActionPayload,
  normalizeCommsRecipient,
  type CommsActionPayload,
} from './authorization.js';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';

const base = {
  channel: 'sms' as const,
  recipient: '+1 (555) 555-0123',
  body: 'A verified owner-approved message',
  subject: 'RyanAI notification',
  contentSid: null,
  contentVariables: null,
  idempotencyKey: 'comms-test-key-0001',
  attachmentIds: ['attachment-a'],
};

describe('owner communications authorization payload', () => {
  it('normalizes phone and email destinations consistently', () => {
    expect(normalizeCommsRecipient('sms', '+1 (555) 555-0123')).toBe('+15555550123');
    expect(normalizeCommsRecipient('email', 'Owner@Example.Test ')).toBe('owner@example.test');
  });

  it('produces a stable digest for the same canonical action', () => {
    const first = buildCommsActionPayload(base);
    const second = buildCommsActionPayload({ ...base, recipient: '+15555550123' });
    expect(hashCommsActionPayload(first)).toBe(hashCommsActionPayload(second));
  });

  it.each([
    ['channel', { channel: 'whatsapp' as const }],
    ['recipient', { recipient: '+15555550124' }],
    ['body', { body: 'A different message' }],
    ['subject', { subject: 'A different subject' }],
    ['template SID', { contentSid: 'HX-template' }],
    ['template variables', { contentVariables: '{"1":"changed"}' }],
    ['idempotency key', { idempotencyKey: 'comms-test-key-0002' }],
    ['attachment list', { attachmentIds: ['attachment-b'] }],
  ])('changes the approval digest when %s changes', (_field, change) => {
    const changed = buildCommsActionPayload({ ...base, ...change } as CommsActionPayload);
    expect(hashCommsActionPayload(changed)).not.toBe(hashCommsActionPayload(buildCommsActionPayload(base)));
  });

  it('requires a verified destination and an exact approved action before dispatch', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 'verified-destination' }])
      .mockResolvedValueOnce([{ id: 'approval-1', status: 'approved' }]);
    await expect(assertCommsActionAuthorized(
      { $queryRawUnsafe: query } as never,
      'owner-test', '00000000-0000-4000-8000-000000000001',
      buildCommsActionPayload(base),
    )).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("status IN ('approved', 'dispatching', 'accepted', 'unknown')");
  });

  it('fails closed when the owner destination is not verified', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    await expect(assertCommsActionAuthorized(
      { $queryRawUnsafe: query } as never,
      'owner-test', '00000000-0000-4000-8000-000000000001',
      buildCommsActionPayload(base),
    )).rejects.toThrow('recipient is not a verified owner destination');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('claims an approved action with a conditional one-time update', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 'verified-destination' }])
      .mockResolvedValueOnce([{ id: 'approval-1' }]);
    await expect(claimCommsAction(
      { $queryRawUnsafe: query } as never,
      'owner-test', '00000000-0000-4000-8000-000000000001',
      buildCommsActionPayload(base),
    )).resolves.toBeUndefined();
    expect(query.mock.calls[1][0]).toContain("status = 'approved'");
    expect(query.mock.calls[1][0]).toContain('RETURNING id');
  });

  it('accepts a verified inbound owner approval once and records the Gen-X rule', async () => {
    vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 'verified-owner-phone' }])
      .mockResolvedValueOnce([{ channel: 'sms', payload_hash: 'a'.repeat(64) }]);
    const execute = vi.fn().mockResolvedValue(1);
    await expect(decideCommsApprovalFromOwner(
      { $queryRawUnsafe: query, $executeRawUnsafe: execute },
      'owner-test', '00000000-0000-4000-8000-000000000001', 'approve',
    )).resolves.toMatchObject({ status: 'approved' });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('comms_verified_destinations');
    expect(execute.mock.calls[0][0]).toContain("status = 'pending'");
    expect(execute.mock.calls[0][3]).toBe('approved');
  });

  it('fails closed when the inbound owner WhatsApp number is not verified', async () => {
    vi.stubEnv('RYANAI_OWNER_PHONE', '+15555550123');
    const query = vi.fn().mockResolvedValue([]);
    const execute = vi.fn();
    await expect(decideCommsApprovalFromOwner(
      { $queryRawUnsafe: query, $executeRawUnsafe: execute },
      'owner-test', '00000000-0000-4000-8000-000000000001', 'approve',
    )).rejects.toThrow('inbound_owner_phone_not_verified');
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps outbound network actions behind the Gen-X human approval gate', () => {
    expect(evaluateGenXSecurityEvent({
      agentId: 'ryanai-api', principal: 'owner-test', toolName: 'api_comms_send',
      action: 'NETWORK', target: 'comms:sms:payload-digest', actorType: 'human',
    })).toMatchObject({ decision: 'REQUIRE_APPROVAL', ruleId: 'GX-HIL-001' });
  });

  it('does not mutate the caller attachment list', () => {
    const attachments = ['attachment-a'];
    const payload = buildCommsActionPayload({ ...base, attachmentIds: attachments });
    payload.attachmentIds.push('attachment-b');
    expect(attachments).toEqual(['attachment-a']);
  });
});
