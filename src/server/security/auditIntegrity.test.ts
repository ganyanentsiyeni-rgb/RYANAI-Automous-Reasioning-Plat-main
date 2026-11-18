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
function linked(recordValue: AuditIntegrityRecord, integrity: ReturnType<typeof createAuditIntegrity>): AuditIntegrityRecord {
  return { ...recordValue, details: { ...(recordValue.details as object), integrity } };
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
    const result = verifyAuditIntegrity([linked(second, secondIntegrity), legacy, linked(first, firstIntegrity)]);
    expect(result).toMatchObject({ valid: true, checked: 2, legacyUnverified: 1, firstInvalidEventId: null });
    expect(result.headHash).toBe(secondIntegrity.eventHash);
  });

  it('detects a changed event payload', () => {
    const original = record('event-1', { reason: 'approved request' });
    const integrity = createAuditIntegrity(original);
    const tampered = record('event-1', { reason: 'rewritten request', integrity });
    expect(verifyAuditIntegrity([tampered])).toMatchObject({
      valid: false, checked: 0, firstInvalidEventId: 'event-1',
    });
  });

  it('detects a broken link and rejects malformed predecessor hashes', () => {
    const first = record('event-1');
    const firstIntegrity = createAuditIntegrity(first);
    const second = record('event-2');
    const secondIntegrity = createAuditIntegrity(second, firstIntegrity.eventHash);
    const broken = { ...second, details: { ...(second.details as object), integrity: { ...secondIntegrity, previousHash: 'f'.repeat(64) } } };
    expect(verifyAuditIntegrity([linked(first, firstIntegrity), broken])).toMatchObject({
      valid: false, firstInvalidEventId: 'event-2',
    });
    expect(() => createAuditIntegrity(second, 'bad')).toThrow('previousHash');
  });

  it('reports an unhashed tail row as legacy because it cannot be distinguished from pre-chain history', () => {
    const first = record('event-1');
    const integrity = createAuditIntegrity(first);
    const missing = record('event-2');
    // A stripped final hash and a genuine pre-chain legacy row are indistinguishable without an external anchor.\n    expect(verifyAuditIntegrity([linked(first, integrity), missing])).toMatchObject({
      valid: true, checked: 1, legacyUnverified: 1, firstInvalidEventId: null,
    });
  });

  it('detects forks that share the same predecessor', () => {
    const first = record('event-1');
    const firstIntegrity = createAuditIntegrity(first);
    const fork = record('event-fork');
    const forkIntegrity = createAuditIntegrity(fork);
    expect(verifyAuditIntegrity([linked(first, firstIntegrity), linked(fork, forkIntegrity)])).toMatchObject({
      valid: false, checked: 0, firstInvalidEventId: 'event-1',
    });
  });

  it('detects disconnected or orphaned chain segments', () => {
    const orphan = record('orphan');
    const orphanIntegrity = createAuditIntegrity(orphan, 'f'.repeat(64));
    expect(verifyAuditIntegrity([linked(orphan, orphanIntegrity)])).toMatchObject({
      valid: false, checked: 0, firstInvalidEventId: 'orphan',
    });
  });
});
