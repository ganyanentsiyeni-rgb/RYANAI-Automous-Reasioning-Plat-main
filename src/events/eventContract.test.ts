import { describe, expect, it } from 'vitest';
import { RyanAIEventEnvelopeSchema } from './eventContract.js';

const validEvent = {
  eventId: '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',
  eventType: 'github.workflow.failed',
  schemaVersion: 1,
  occurredAt: '2026-11-18T12:00:00.000Z',
  source: { provider: 'github', service: 'actions' },
  correlationId: 'incident-123',
  idempotencyKey: 'github:workflow:run:456',
  classification: 'internal',
  payload: { repository: 'owner/repo', runId: 456 },
};

describe('RyanAI event envelope', () => {
  it('accepts a valid provider-neutral event', () => {
    expect(RyanAIEventEnvelopeSchema.safeParse(validEvent).success).toBe(true);
  });

  it('rejects malformed event identifiers and event types', () => {
    expect(
      RyanAIEventEnvelopeSchema.safeParse({
        ...validEvent,
        eventId: 'not-a-uuid',
        eventType: 'GitHub Workflow Failed',
      }).success,
    ).toBe(false);
  });

  it('requires an explicit timezone in the occurrence timestamp', () => {
    expect(
      RyanAIEventEnvelopeSchema.safeParse({
        ...validEvent,
        occurredAt: '2026-11-18T12:00:00',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown envelope fields to prevent silent contract drift', () => {
    expect(
      RyanAIEventEnvelopeSchema.safeParse({
        ...validEvent,
        trusted: true,
      }).success,
    ).toBe(false);
  });

  it('requires an idempotency key and explicit data classification', () => {
    const incomplete = { ...validEvent, idempotencyKey: undefined, classification: undefined };
    expect(RyanAIEventEnvelopeSchema.safeParse(incomplete).success).toBe(false);
  });
});
