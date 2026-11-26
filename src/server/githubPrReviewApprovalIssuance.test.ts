import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGitHubReviewInstallationToken, readGitHubReviewAppConfig, enqueueCommsAssistRun } = vi.hoisted(() => ({
  getGitHubReviewInstallationToken: vi.fn(),
  readGitHubReviewAppConfig: vi.fn(),
  enqueueCommsAssistRun: vi.fn(),
}));
vi.mock('./githubAppReview.js', () => ({
  GITHUB_REVIEW_REPOSITORY: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
  getGitHubReviewInstallationToken,
  readGitHubReviewAppConfig,
}));
vi.mock('./comms/agentRuns.js', () => ({ enqueueCommsAssistRun }));

import { issueOwnerGitHubPrReviewApproval } from './githubPrReviewApprovalIssuance.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(40);
const config = { appId: '5864885', installationId: '12345678', privateKey: 'test-key' };
const issuedRow = { id: '22222222-2222-4222-8222-222222222222', expected_head_sha: sha, expires_at: '2026-11-26T18:15:00.000Z' };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Self-Patch review approval issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readGitHubReviewAppConfig.mockReturnValue(config);
    getGitHubReviewInstallationToken.mockResolvedValue('installation-token');
    enqueueCommsAssistRun.mockResolvedValue({ runId: 'comms_assist_1', status: 'queued' });
  });

  it('binds a pending approval to the live open canonical main PR head and queues internal Comms', async () => {
    const query = vi.fn().mockResolvedValue([issuedRow]);
    const execute = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(response({
      state: 'open', base: { ref: 'main' },
      head: { sha, repo: { full_name: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' } },
    }));
    const result = await issueOwnerGitHubPrReviewApproval(
      { $queryRawUnsafe: query, $executeRawUnsafe: execute },
      { ownerUserId, pullRequestNumber: 42 },
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain("'pending', NOW() + INTERVAL '15 minutes'");
    expect(query.mock.calls[0][4]).toBe(sha);
    expect(enqueueCommsAssistRun).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId,
      idempotencyKey: expect.stringContaining('github-pr-review-approval:'),
      objective: expect.stringContaining('outbound'),
    }));
    expect(result).toMatchObject({
      approvalId: issuedRow.id, pullRequestNumber: 42, expectedHeadSha: sha,
      commsRunId: 'comms_assist_1',
    });
  });

  it('rejects closed, non-main, or cross-repository PRs without creating approval or Comms work', async () => {
    const query = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(response({
      state: 'closed', base: { ref: 'release' },
      head: { sha, repo: { full_name: 'someone/other-repo' } },
    }));
    await expect(issueOwnerGitHubPrReviewApproval(
      { $queryRawUnsafe: query, $executeRawUnsafe: vi.fn() },
      { ownerUserId, pullRequestNumber: 42 },
      { fetcher: fetcher as unknown as typeof fetch },
    )).rejects.toThrow('github_pull_request_not_eligible');
    expect(query).not.toHaveBeenCalled();
    expect(enqueueCommsAssistRun).not.toHaveBeenCalled();
  });

  it('marks the pending record blocked if internal Comms task creation fails', async () => {
    const query = vi.fn().mockResolvedValue([issuedRow]);
    const execute = vi.fn().mockResolvedValue(1);
    enqueueCommsAssistRun.mockRejectedValueOnce(new Error('queue unavailable'));
    const fetcher = vi.fn().mockResolvedValue(response({
      state: 'open', base: { ref: 'main' },
      head: { sha, repo: { full_name: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' } },
    }));
    await expect(issueOwnerGitHubPrReviewApproval(
      { $queryRawUnsafe: query, $executeRawUnsafe: execute },
      { ownerUserId, pullRequestNumber: 42 },
      { fetcher: fetcher as unknown as typeof fetch },
    )).rejects.toThrow('github_pr_review_comms_task_not_created');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toContain("SET status = 'blocked'");
  });
});
