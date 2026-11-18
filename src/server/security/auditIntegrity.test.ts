// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AUDIT_INTEGRITY_GENESIS_HASH,
  createAuditIntegrity,
  verifyAuditIntegrity,
  type AuditIntegrityRecord,
} from './auditIntegrity.js';

function record(id: string, details: Record<string, unknown> = {}): AuditIntegrityRecord {
  return { id, actorId: 'owner-1', eventType: 'ACCOUNT_LIFECYCLE_REQUESTED', resourceId: 'target-1', details };
}

describe('lifecycle audit hash-chain integrity', () => {
  it('creates deterministic SHA-256 metadata independent of object key order', () => {
    const first = record('event-1', { action: 'suspend_account', reason: 'security review' });
    const reordered = record('event-1', { reason: 'security review', action: 'suspend_account' });
    expect(createAuditIntegrity(first)).toEqual(createAuditIntegrity(reordered));
    expect(createAuditIntegrity(first).previousHash).toBe(AUDIT_INTEGRITY_GENESIS_HASH);
  });

  it('verifies a linked sequence and reports legacy rows separately', () => {
    const legacy = record('legacy-event');
    const first = record('event-1', { requestId: 'request-1' });
    const firstIntegrity = createAuditIntegrity(first);
    const second = record('event-2', { requestId: 'request-2' });
    const secondIntegrity = createAuditIntegrity(second, firstIntegrity.eventHash);
    const result = verifyAuditIntegrity([
      legacy,
      { ...first, details: { ...(first.details as object), integrity: firstIntegrity } },
      { ...second, details: { ...(second.details as object), integrity: secondIntegrity } },
    ]);
    expect(result).toMatchObject({ valid: true, checked: 2, legacyUnverified: 1, firstInvalidEventId: null });
    expect(result.headHash).toBe(secondIntegrity.eventHash);
  });

  it('detects a changed event payload', () => {
    const original = record('event-1', { reason: 'approved request' });
    const integrity = createAuditIntegrity(original);
    const tampered = record('event-1', { reason: 'rewritten request', integrity });
    expect(verifyAuditIntegrity([tampered])).toMatchObject({
      valid: false,
      checked: 0,
      firstInvalidEventId: 'event-1',
    });
  });

  it('detects a broken link and rejects malformed predecessor hashes', () => {
    const first = record('event-1');
    const firstIntegrity = createAuditIntegrity(first);
    const second = record('event-2');
    const secondIntegrity = createAuditIntegrity(second, firstIntegrity.eventHash);
    const broken = { ...second, details: { ...(second.details as object), integrity: { ...secondIntegrity, previousHash: 'f'.repeat(64) } } };
    expect(verifyAuditIntegrity([
      { ...first, details: { ...(first.details as object), integrity: firstIntegrity } },
      broken,
    ])).toMatchObject({ valid: false, firstInvalidEventId: 'event-2' });
    expect(() => createAuditIntegrity(second, 'bad')).toThrow('previousHash');
  });

  it('detects a missing integrity record after the chain has started', () => {
    const first = record('event-1');
    const integrity = createAuditIntegrity(first);
    expect(verifyAuditIntegrity([
      { ...first, details: { ...(first.details as object), integrity } },
      record('event-2'),
    ])).toMatchObject({ valid: true, checked: 1, legacyUnverified: 0 });
  });
});
