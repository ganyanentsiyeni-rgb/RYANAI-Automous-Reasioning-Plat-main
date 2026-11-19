import { describe, expect, it } from 'vitest';
import { resolvePAApprovalTransition } from './paDelegationApproval.js';

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
