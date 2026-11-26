import { describe, expect, it, vi } from 'vitest';
import { recordOwnerGitHubPrReviewDecision } from './githubPrReviewApproval.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const approvalId = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(40);
const sid = 'SM' + '1'.repeat(32);
const env = { RYANAI_OWNER_PHONE: '+15555550123' } as NodeJS.ProcessEnv;

describe('durable WhatsApp GitHub PR review approval', () => {
  it('fails closed on approval until independent Gen-X authorization is available', async () => {
    const query = vi.fn();
    await expect(recordOwnerGitHubPrReviewDecision(
      { $queryRawUnsafe: query }, {
        ownerUserId, approvalId, expectedHeadSha: sha, inboundMessageSid: sid, decision: 'approve',
      }, env,
    )).rejects.toThrow('genx_authorization_unavailable');
    expect(query).not.toHaveBeenCalled();
  });

  it('records a rejection without setting approved or consumed timestamps', async () => {
    const query = vi.fn().mockResolvedValue([{
      id: approvalId, pull_request_number: 42, expected_head_sha: sha, status: 'rejected',
    }]);
    const result = await recordOwnerGitHubPrReviewDecision(
      { $queryRawUnsafe: query }, {
        ownerUserId, approvalId, expectedHeadSha: sha, inboundMessageSid: sid, decision: 'reject',
      }, env,
    );
    expect(result.status).toBe('rejected');
    expect(query.mock.calls[0][0]).toContain("CASE WHEN $6 = 'approved'");
    expect(query.mock.calls[0][6]).toBe('rejected');
  });

  it('rejects malformed or missing owner-bound input before touching the database', async () => {
    const query = vi.fn();
    await expect(recordOwnerGitHubPrReviewDecision(
      { $queryRawUnsafe: query }, {
        ownerUserId, approvalId, expectedHeadSha: 'not-a-sha',
        inboundMessageSid: sid, decision: 'approve',
      }, env,
    )).rejects.toThrow('invalid_github_pr_review_approval');
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the configured owner phone and never trusts a caller-provided destination', async () => {
    const query = vi.fn();
    await expect(recordOwnerGitHubPrReviewDecision(
      { $queryRawUnsafe: query }, {
        ownerUserId, approvalId, expectedHeadSha: sha,
        inboundMessageSid: sid, decision: 'approve',
      }, {} as NodeJS.ProcessEnv,
    )).rejects.toThrow('inbound_owner_phone_not_configured');
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the record is expired, replayed, stale, or destination is unverified', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(recordOwnerGitHubPrReviewDecision(
      { $queryRawUnsafe: query }, {
        ownerUserId, approvalId, expectedHeadSha: sha,
        inboundMessageSid: sid, decision: 'approve',
      }, env,
    )).rejects.toThrow('github_pr_review_approval_not_found_expired_or_already_used');
  });
});
