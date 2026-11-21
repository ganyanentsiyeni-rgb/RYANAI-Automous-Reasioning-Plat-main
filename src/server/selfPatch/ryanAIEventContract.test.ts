import { describe, expect, it } from 'vitest';
import { parseRyanAIEvent, RYANAI_REPOSITORY } from './ryanAIEventContract.js';

const common = {
  schemaVersion: 1,
  repository: RYANAI_REPOSITORY,
  commitSha: 'a'.repeat(40),
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  occurredAt: '2026-11-21T12:00:00.000Z',
};

const commsReceipt = {
  ...common,
  eventType: 'comms.delivery.receipt',
  source: 'ryanai-comms',
  correlationId: 'comms-test-20261121-0001',
  channel: 'sms',
  state: 'accepted_by_provider',
};

describe('RyanAI event contract', () => {
  it('accepts a scoped Comms receipt without upgrading provider acceptance to delivery', () => {
    expect(parseRyanAIEvent(commsReceipt)).toMatchObject({
      eventType: 'comms.delivery.receipt',
      state: 'accepted_by_provider',
      repository: RYANAI_REPOSITORY,
    });
  });

  it('accepts each explicitly modeled non-delivery Comms state', () => {
    for (const state of [
      'not_configured', 'blocked_by_policy_boundary', 'blocked_by_provider',
      'queued', 'accepted_by_provider', 'failed', 'unknown', 'not_tested',
    ]) {
      expect(parseRyanAIEvent({ ...commsReceipt, state })).not.toBeNull();
    }
  });

  it('requires a valid provider receipt hash before accepting delivered state', () => {
    expect(parseRyanAIEvent({ ...commsReceipt, state: 'delivered' })).toBeNull();
    expect(parseRyanAIEvent({
      ...commsReceipt,
      state: 'delivered',
      providerReferenceHash: 'b'.repeat(64),
    })).toMatchObject({ state: 'delivered', providerReferenceHash: 'b'.repeat(64) });
  });

  it('accepts a Self-Patch finding with only its own strict contract fields', () => {
    expect(parseRyanAIEvent({
      ...common,
      eventType: 'selfpatch.audit.finding',
      source: 'ryanai-self-patch',
      correlationId: 'selfpatch-test-20261121-0001',
      severity: 'warning',
      findingCode: 'workflow.check.missing',
    })).toMatchObject({
      eventType: 'selfpatch.audit.finding',
      findingCode: 'workflow.check.missing',
    });
  });

  it('rejects another repository, malformed commit SHA, invalid timestamps and short correlation IDs', () => {
    expect(parseRyanAIEvent({ ...commsReceipt, repository: 'someone/other-repo' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, commitSha: 'main' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, occurredAt: 'yesterday' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, correlationId: 'short' })).toBeNull();
  });

  it('rejects Gen-X/Jarvis sources, unknown event types and unknown fields', () => {
    expect(parseRyanAIEvent({ ...commsReceipt, source: 'genx' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, source: 'jarvis' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, eventType: 'agent.execute' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, body: 'private message' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, recipient: '+27123456789' })).toBeNull();
    expect(parseRyanAIEvent({ ...commsReceipt, authToken: 'must-not-leak' })).toBeNull();
  });
});
