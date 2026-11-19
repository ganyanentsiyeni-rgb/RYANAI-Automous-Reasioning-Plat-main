export type PAApprovalTransition = 'approved' | 'already_approved' | 'conflict';

/** Classify the result of the conditional approval write after a concurrent transaction. */
export function resolvePAApprovalTransition(
  updatedCount: number,
  latestApprovalStatus: string | null,
): PAApprovalTransition {
  if (updatedCount === 1) return 'approved';
  if (updatedCount === 0 && latestApprovalStatus === 'approved') return 'already_approved';
  return 'conflict';
}
