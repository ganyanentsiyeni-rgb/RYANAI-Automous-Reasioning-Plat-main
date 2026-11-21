import { describe, expect, it } from 'vitest';
import { parseRyanAIEvent, RYANAI_REPOSITORY } from './ryanAIEventContract.js';

const base = {
  schemaVersion: 1,
  eventType: 'comms.delivery.receipt',
  source: 'ryanai-comms',
  repository: RYANAI_REPOSITORY,
  commitSha: 'a'.repeat(40),
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  correlationId: 'comms-test-20261121-0001',
  occurredAt: '2026-11-21T12:00:00.000Z',
  channel: 'sms',
  state: 'accepted_by_provider',
};

describe('RyanAI event contract', () => {
  it('accepts a scoped Comms receipt without upgrading provider acceptance to delivery', () => {
    expect(parseRyanAIEvent(base)).toMatchObject({
      eventType: 'comms.delivery.receipt',
      state: 'accepted_by_provider',
      repository: RYANAI_REPOSITORY,
    });
  });

  it('accepts a RyanAI Self-Patch finding', () => {
    expect(parseRyanAIEvent({
      schemaVersion: 1,
      eventType: 'selfpatch.audit.finding',
      source: 'ryanai-self-patch',
      repository: RYANAI_REPOSITORY,
      commitSha: 'a'.repeat(40),
      eventId: '123e4567-e89b-42d3-a456-426614174000',
      correlationId: 'selfpatch-test-20261121-0001',
      occurredAt: '2026-11-21T12:00:00.000Z',
      ...base,
      eventType: 'selfpatch.audit.finding',
      source: 'ryanai-self-patch',
      severity: 'warning',
      findingCode: 'workflow.check.missing',
    })).toMatchObject({ eventType: 'selfpatch.audit.finding', findingCode: 'workflow.check.missing' });
  });

  it('rejects another repository or malformed commit SHA', () => {
    expect(parseRyanAIEvent({ ...base, repository: 'someone/other-repo' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, commitSha: 'main' })).toBeNull();
  });

  it('rejects Gen-X/Jarvis sources and unknown event types', () => {
    expect(parseRyanAIEvent({ ...base, source: 'genx' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, source: 'jarvis' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, eventType: 'agent.execute' })).toBeNull();
  });

  it('rejects message bodies, recipient addresses and credential-like extra fields', () => {
    expect(parseRyanAIEvent({ ...base, body: 'private message' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, recipient: '+27123456789' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, authToken: 'must-not-leak' })).toBeNull();
  });

  it('requires a valid provider receipt hash before accepting delivered state', () => {
    expect(parseRyanAIEvent({ ...base, state: 'sent' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, state: 'delivered' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, state: 'delivered', providerReferenceHash: 'bad' })).toBeNull();
    expect(parseRyanAIEvent({
      ...base,
      state: 'delivered',
      providerReferenceHash: 'b'.repeat(64),
    })).toMatchObject({ state: 'delivered', providerReferenceHash: 'b'.repeat(64) });
  it('rejects delivered state unless explicitly represented by a validated receipt', () => {
    expect(parseRyanAIEvent({ ...base, state: 'sent' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, state: 'delivered', providerReferenceHash: 'bad' })).toBeNull();
  });

  it('rejects invalid correlation IDs and timestamps', () => {
    expect(parseRyanAIEvent({ ...base, correlationId: 'short' })).toBeNull();
    expect(parseRyanAIEvent({ ...base, occurredAt: 'yesterday' })).toBeNull();
  });
});
