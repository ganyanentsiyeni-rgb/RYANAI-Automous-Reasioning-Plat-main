import { randomUUID } from 'node:crypto';
import {
  GITHUB_REVIEW_REPOSITORY,
  getGitHubReviewInstallationToken,
  readGitHubReviewAppConfig,
} from './githubAppReview.js';
import { enqueueCommsAssistRun } from './comms/agentRuns.js';

interface ApprovalIssuancePrisma {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

interface IssuedApprovalRow {
  id: string;
  expected_head_sha: string;
  expires_at: Date | string;
}

export type ApprovalIssuanceResult = {
  approvalId: string;
  repository: typeof GITHUB_REVIEW_REPOSITORY;
  pullRequestNumber: number;
  expectedHeadSha: string;
  expiresAt: string;
  commsRunId: string;
  commsStatus: string;
};

type FetchLike = typeof fetch;

/**
 * Creates an expiring, owner-scoped request for a review of the current open PR head.
 * The internal Comms AgentRun is an instruction/task only: outbound provider dispatch
 * is explicitly disabled and requires its separate authorization flow.
 */
export async function issueOwnerGitHubPrReviewApproval(
  prisma: ApprovalIssuancePrisma,
  input: { ownerUserId: string; pullRequestNumber: number },
  dependencies: {
    fetcher?: FetchLike;
    env?: NodeJS.ProcessEnv;
    enqueueComms?: typeof enqueueCommsAssistRun;
  } = {},
): Promise<ApprovalIssuanceResult> {
  if (!input.ownerUserId || !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber < 1 || input.pullRequestNumber > 2_147_483_647) {
    throw new Error('invalid_github_pr_review_request');
  }

  const config = readGitHubReviewAppConfig(dependencies.env ?? process.env);
  if (!config) throw new Error('github_review_app_not_configured');
  const fetcher = dependencies.fetcher ?? fetch;
  const token = await getGitHubReviewInstallationToken(config, fetcher);
  if (!token) throw new Error('github_review_app_installation_unavailable');

  const response = await fetcher(
    `https://api.github.com/repos/${GITHUB_REVIEW_REPOSITORY}/pulls/${input.pullRequestNumber}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error('github_pull_request_unavailable');
  const pull = await response.json() as {
    state?: unknown;
    base?: { ref?: unknown };
    head?: { sha?: unknown; repo?: { full_name?: unknown } };
  };
  const sha = typeof pull.head?.sha === 'string' ? pull.head.sha.toLowerCase() : '';
  if (pull.state !== 'open' || pull.base?.ref !== 'main' ||
      pull.head?.repo?.full_name !== GITHUB_REVIEW_REPOSITORY || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('github_pull_request_not_eligible');
  }

  const approvalId = randomUUID();
  const rows = await prisma.$queryRawUnsafe<IssuedApprovalRow[]>(
    `INSERT INTO public.github_pr_review_approvals
       (id, owner_user_id, repository_full_name, pull_request_number, expected_head_sha, status, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'pending', NOW() + INTERVAL '15 minutes')
     RETURNING id, expected_head_sha, expires_at`,
    approvalId, input.ownerUserId, GITHUB_REVIEW_REPOSITORY, input.pullRequestNumber, sha,
  );
  const row = rows[0];
  if (!row) throw new Error('github_pr_review_approval_not_created');

  const enqueue = dependencies.enqueueComms ?? enqueueCommsAssistRun;
  try {
    const comms = await enqueue({
      ownerUserId: input.ownerUserId,
      idempotencyKey: 'github-pr-review-approval:' + approvalId,
      objective: [
        'Create an internal RyanAI Comms task for an owner review decision.',
        'Canonical repository: ' + GITHUB_REVIEW_REPOSITORY,
        'Pull request: #' + input.pullRequestNumber,
        'Exact candidate head SHA: ' + sha,
        'Approval reference: ' + approvalId,
        'Expiry: 15 minutes from issuance.',
        'Ask the verified owner to review this exact PR revision and reply with the documented GITHUB APPROVE or GITHUB REJECT command.',
        'This is an internal task only. Do not send WhatsApp, SMS, voice, email, or any external message.',
        'Do not submit a GitHub review, merge, deploy, or modify production.',
      ].join('\\n'),
    });
    return {
      approvalId: row.id,
      repository: GITHUB_REVIEW_REPOSITORY,
      pullRequestNumber: input.pullRequestNumber,
      expectedHeadSha: sha,
      expiresAt: new Date(row.expires_at).toISOString(),
      commsRunId: comms.runId,
      commsStatus: comms.status,
    };
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE public.github_pr_review_approvals
          SET status = 'blocked', updated_at = NOW()
        WHERE id = $1::uuid AND status = 'pending'`,
      approvalId,
    );
    throw new Error('github_pr_review_comms_task_not_created', { cause: error });
  }
}
