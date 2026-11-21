import { describe, expect, it } from 'vitest';
import {
  isEligibleHumanApproval,
  normalizeReviewProvenance,
  type CopilotReviewProvenanceInput,
} from './githubReviewProvenance.js';

const head = 'a'.repeat(40);
const base: CopilotReviewProvenanceInput = {
  reviewId: 'review-123',
  pullRequestNumber: 1327,
  reviewedCommitSha: head,
  submittedAt: new Date(Date.now() - 60_000).toISOString(),
  state: 'APPROVED',
  actorKind: 'human',
  effortLevel: 'balanced',
  commentAttributions: [
    { commentId: 'comment-1', sourceKinds: ['skill', 'mcp', 'private-tool-name'] },
    { commentId: 'comment-2', sourceKinds: ['custom_instructions'] },
  ],
};

describe('GitHub review provenance privacy contract', () => {
  it('keeps only normalized attribution, effort and source categories', () => {
    const normalized = normalizeReviewProvenance(base);
    expect(normalized).toMatchObject({
      schemaVersion: 'ryanai.github-review-provenance/v1',
      actorKind: 'human',
      state: 'APPROVED',
      effortLevel: 'balanced',
      commentAttributions: [
        { commentId: 'comment-1', sourceKinds: ['skill', 'mcp'] },
        { commentId: 'comment-2', sourceKinds: ['custom_instructions'] },
      ],
    });
    expect(JSON.stringify(normalized)).not.toContain('private-tool-name');
  });

  it('does not infer Copilot attribution from a reviewer name or missing metadata', () => {
    const normalized = normalizeReviewProvenance({ ...base, actorKind: 'unknown' });
    expect(normalized?.actorKind).toBe('unknown');
    expect(normalized && isEligibleHumanApproval(normalized, head)).toBe(false);
  });

  it('never lets a Copilot approval satisfy human approval', () => {
    const normalized = normalizeReviewProvenance({ ...base, actorKind: 'copilot' });
    expect(normalized && isEligibleHumanApproval(normalized, head)).toBe(false);
  });

  it('requires an approved human review on the exact current head', () => {
    const normalized = normalizeReviewProvenance(base)!;
    expect(isEligibleHumanApproval(normalized, head)).toBe(true);
    expect(isEligibleHumanApproval(normalized, 'b'.repeat(40))).toBe(false);
    expect(isEligibleHumanApproval({ ...normalized, state: 'COMMENTED' }, head)).toBe(false);
  });

  it('rejects malformed identities, timestamps, commit SHAs and future evidence', () => {
    expect(normalizeReviewProvenance({ ...base, reviewedCommitSha: 'not-a-sha' })).toBeNull();
    expect(normalizeReviewProvenance({ ...base, pullRequestNumber: 0 })).toBeNull();
    expect(normalizeReviewProvenance({ ...base, submittedAt: 'not-a-date' })).toBeNull();
    expect(normalizeReviewProvenance({ ...base, submittedAt: '2999-01-01T00:00:00Z' })).toBeNull();
  });

  it('drops unsupported effort levels and unrecognized source categories', () => {
    const normalized = normalizeReviewProvenance({
      ...base,
      effortLevel: 'ultra',
      commentAttributions: [
        { commentId: 'comment-3', sourceKinds: ['mcp', 'raw-comment-text', 'custom_instructions'] },
      ],
    });
    expect(normalized?.effortLevel).toBeUndefined();
    expect(normalized?.commentAttributions).toEqual([
      { commentId: 'comment-3', sourceKinds: ['mcp', 'custom_instructions'] },
    ]);
  });
});
