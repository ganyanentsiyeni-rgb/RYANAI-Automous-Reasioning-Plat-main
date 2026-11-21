import { createSign } from 'node:crypto';

export const GITHUB_REVIEW_REPOSITORY =
  'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main';
export const GITHUB_REVIEW_APP_ID = '5864885';
const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 10_000;

export interface GitHubReviewAppConfig {
  appId: string;
  installationId: string;
  privateKey: string;
}

export interface GitHubReviewRequest {
  pullRequestNumber: number;
  expectedHeadSha: string;
  ownerApprovalVerified: true;
  approvalEventId: string;
}

export type GitHubReviewResult =
  | { status: 'submitted'; reviewId: number; commitSha: string }
  | { status: 'blocked'; reason: 'invalid_request' | 'app_not_configured' | 'installation_unavailable' | 'pull_request_unavailable' | 'pull_request_not_open' | 'head_sha_mismatch' | 'review_submission_failed' };

type FetchLike = typeof fetch;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function readGitHubReviewAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubReviewAppConfig | null {
  const appId = env.GITHUB_REVIEW_APP_ID?.trim();
  const installationId = env.GITHUB_REVIEW_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_REVIEW_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (appId !== GITHUB_REVIEW_APP_ID || !installationId || !/^\d+$/.test(installationId) ||
      !privateKey?.includes('-----BEGIN') || !privateKey.includes('PRIVATE KEY-----')) return null;
  return { appId, installationId, privateKey };
}

export function createGitHubAppJwt(config: GitHubReviewAppConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 8 * 60, iss: config.appId }));
  const unsigned = header + '.' + payload;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return unsigned + '.' + signer.sign(config.privateKey).toString('base64url');
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

async function getInstallationToken(
  config: GitHubReviewAppConfig,
  fetcher: FetchLike,
): Promise<string | null> {
  let jwt: string;
  try {
    jwt = createGitHubAppJwt(config);
  } catch {
    return null;
  }
  const response = await fetcher(
    `https://api.github.com/app/installations/${config.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + jwt,
        'X-GitHub-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repositories: ['RYANAI-Automous-Reasioning-Plat-main'] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const payload = await json(response);
  return response.ok && typeof payload.token === 'string' ? payload.token : null;
}

/**
 * Submit an approval only for a previously owner-verified, one-time Comms event.
 * The caller must enforce durable idempotency for approvalEventId before invoking.
 * The repository is fixed in code; the PR's live head is fetched immediately before
 * POSTing the review, and must equal the owner-confirmed SHA.
 */
export async function submitOwnerApprovedGitHubReview(
  request: GitHubReviewRequest,
  config = readGitHubReviewAppConfig(),
  fetcher: FetchLike = fetch,
): Promise<GitHubReviewResult> {
  if (!Number.isSafeInteger(request.pullRequestNumber) || request.pullRequestNumber < 1 ||
      !/^[a-f0-9]{40}$/i.test(request.expectedHeadSha) ||
      request.ownerApprovalVerified !== true ||
      !/^[0-9a-f-]{36}$/i.test(request.approvalEventId)) {
    return { status: 'blocked', reason: 'invalid_request' };
  }
  if (!config) return { status: 'blocked', reason: 'app_not_configured' };

  const token = await getInstallationToken(config, fetcher);
  if (!token) return { status: 'blocked', reason: 'installation_unavailable' };

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': API_VERSION,
  };
  const pullResponse = await fetcher(
    `https://api.github.com/repos/${GITHUB_REVIEW_REPOSITORY}/pulls/${request.pullRequestNumber}`,
    { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (!pullResponse.ok) return { status: 'blocked', reason: 'pull_request_unavailable' };
  const pull = await json(pullResponse);
  const head = pull.head && typeof pull.head === 'object'
    ? (pull.head as Record<string, unknown>).sha
    : undefined;
  if (pull.state !== 'open') return { status: 'blocked', reason: 'pull_request_not_open' };
  if (typeof head !== 'string' || head.toLowerCase() !== request.expectedHeadSha.toLowerCase()) {
    return { status: 'blocked', reason: 'head_sha_mismatch' };
  }

  const reviewResponse = await fetcher(
    `https://api.github.com/repos/${GITHUB_REVIEW_REPOSITORY}/pulls/${request.pullRequestNumber}/reviews`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'APPROVE', commit_id: request.expectedHeadSha }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const review = await json(reviewResponse);
  if (!reviewResponse.ok || !Number.isSafeInteger(review.id)) {
    return { status: 'blocked', reason: 'review_submission_failed' };
  }
  return { status: 'submitted', reviewId: Number(review.id), commitSha: request.expectedHeadSha };
}
