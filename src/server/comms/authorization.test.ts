import { describe, expect, it } from 'vitest';
import {
  buildCommsActionPayload,
  hashCommsActionPayload,
  normalizeCommsRecipient,
} from './authorization.js';

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
    const changed = buildCommsActionPayload({ ...base, ...change } as typeof base);
    expect(hashCommsActionPayload(changed)).not.toBe(hashCommsActionPayload(buildCommsActionPayload(base)));
  });

  it('does not mutate the caller attachment list', () => {
    const attachments = ['attachment-a'];
    const payload = buildCommsActionPayload({ ...base, attachmentIds: attachments });
    payload.attachmentIds.push('attachment-b');
    expect(attachments).toEqual(['attachment-a']);
  });
});
