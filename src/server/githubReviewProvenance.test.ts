import { describe, expect, it } from 'vitest';
import { mapPullRequestReviewProvenance } from './githubReviewProvenance.js';

const head = 'a'.repeat(40);
const payload = {
  repository: {
    pullRequest: {
      headRefOid: head,
      reviews: {
        totalCount: 2,
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            id: 'PRR_copilot',
            state: 'COMMENTED',
            submittedAt: '2026-11-08T09:00:00.000Z',
            commit: { oid: head },
            author: { __typename: 'Bot', login: 'copilot-reviewer[bot]' },
            isCopilotCodeReview: true,
            copilotCodeReviewEffort: 'BALANCED',
            comments: {
              pageInfo: { hasNextPage: false },
              nodes: [{
                id: 'PRRC_1',
                isCopilotCodeReview: true,
                copilotCodeReviewSources: [
                  { kind: 'SKILL', name: 'internal-secure-review', path: '.github/skills/security/SKILL.md' },
                  { kind: 'MCP', name: 'private-service-catalog' },
                  { kind: 'CUSTOM_INSTRUCTIONS', name: 'custom instructions' },
                ],
                body: 'Do not expose this review text',
              }],
            },
            body: 'Do not expose this review text',
          },
          {
            id: 'PRR_human',
            state: 'APPROVED',
            submittedAt: '2026-11-08T09:05:00.000Z',
            commit: { oid: head },
            author: { __typename: 'User', login: 'reviewer-private-login' },
            isCopilotCodeReview: false,
            comments: { pageInfo: { hasNextPage: false }, nodes: [] },
            body: 'Human approval text',
          },
        ],
      },
    },
  },
};

describe('GraphQL Copilot review provenance mapper', () => {
  it('normalizes explicit Copilot attribution, effort and source categories without sensitive text', () => {
    const result = mapPullRequestReviewProvenance(payload, 1330)!;
    expect(result.copilotReviewCount).toBe(1);
    expect(result.reviews[0]).toMatchObject({
      actorKind: 'copilot',
      effortLevel: 'balanced',
      commentAttributions: [{
        commentId: 'PRRC_1',
        sourceKinds: ['skill', 'mcp', 'custom_instructions'],
      }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Do not expose');
    expect(serialized).not.toContain('internal-secure-review');
    expect(serialized).not.toContain('private-service-catalog');
    expect(serialized).not.toContain('reviewer-private-login');
    expect(serialized).not.toContain('SKILL.md');
  });

  it('counts only exact-head human approvals; Copilot cannot satisfy approval', () => {
    expect(mapPullRequestReviewProvenance(payload, 1330)?.exactHeadHumanApprovalCount).toBe(1);
    const changed = structuredClone(payload);
    changed.repository.pullRequest.reviews.nodes[1].commit.oid = 'b'.repeat(40);
    expect(mapPullRequestReviewProvenance(changed, 1330)?.exactHeadHumanApprovalCount).toBe(0);
  });

  it('marks snapshots incomplete when review or comment pagination is truncated', () => {
    const reviewPage = structuredClone(payload);
    reviewPage.repository.pullRequest.reviews.pageInfo.hasNextPage = true;
    expect(mapPullRequestReviewProvenance(reviewPage, 1330)?.complete).toBe(false);
    const commentPage = structuredClone(payload);
    commentPage.repository.pullRequest.reviews.nodes[0].comments.pageInfo.hasNextPage = true;
    expect(mapPullRequestReviewProvenance(commentPage, 1330)?.complete).toBe(false);
  });

  it('fails closed on invalid PR identity or missing exact head SHA', () => {
    expect(mapPullRequestReviewProvenance(payload, 0)).toBeNull();
    expect(mapPullRequestReviewProvenance({
      repository: { pullRequest: { headRefOid: 'unknown', reviews: { nodes: [] } } },
    }, 1330)).toBeNull();
  });
});
