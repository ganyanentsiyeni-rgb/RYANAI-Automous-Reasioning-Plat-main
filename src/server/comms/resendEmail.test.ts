import { describe, expect, it } from 'vitest';
import { mapResendEmailDeliveryState } from './resendEmail.js';

describe('Resend email delivery event mapping', () => {
  it.each([
    ['email.sent', 'accepted_by_provider'],
    ['email.delivered', 'delivered'],
    ['email.opened', 'delivered'],
    ['email.clicked', 'delivered'],
    ['email.delivery_delayed', 'queued'],
    ['email.bounced', 'failed'],
    ['email.complained', 'failed'],
    ['email.failed', 'failed'],
    ['email.suppressed', 'failed'],
    ['email.received', 'unknown'],
    ['unknown.event', 'unknown'],
  ] as const)('maps %s to %s', (eventType, expected) => {
    expect(mapResendEmailDeliveryState(eventType)).toBe(expected);
  });

  it('normalizes event type casing and surrounding whitespace', () => {
    expect(mapResendEmailDeliveryState(' EMAIL.DELIVERED ')).toBe('delivered');
  });
});
