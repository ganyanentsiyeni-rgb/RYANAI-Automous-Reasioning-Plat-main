import { describe, expect, it } from 'vitest';
import { resolvePAApprovalTransition, resolvePARejectionTransition } from './paDelegationApproval.js';

describe('PA delegation approval transition', () => {
  it('accepts exactly one conditional approval writer', () => {
    expect(resolvePAApprovalTransition(1, 'approved')).toBe('approved');
  });

  it('treats a concurrent retry as idempotent after the first approval commits', () => {
    expect(resolvePAApprovalTransition(0, 'approved')).toBe('already_approved');
  });

  it('rejects a lost conditional write when the run is not approved', () => {
    expect(resolvePAApprovalTransition(0, 'pending')).toBe('conflict');
    expect(resolvePAApprovalTransition(0, null)).toBe('conflict');
  });
});

describe('PA delegation rejection transition', () => {
  it('accepts only the single conditional rejection writer', () => {
    expect(resolvePARejectionTransition(1)).toBe('rejected');
  });

  it('does not report rejection when approval or worker state already won', () => {
    expect(resolvePARejectionTransition(0)).toBe('conflict');
    expect(resolvePARejectionTransition(2)).toBe('conflict');
  });
});
