import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGitHubAppJwt,
  readGitHubReviewAppConfig,
  submitOwnerApprovedGitHubReview,
  type GitHubReviewAppConfig,
} from './githubAppReview.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: GitHubReviewAppConfig = {
  appId: '5864885',
  installationId: '12345678',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const sha = 'a'.repeat(40);
const approvalEventId = '123e4567-e89b-42d3-a456-426614174000';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GitHub App exact-head review client', () => {
  it('requires the expected app ID, installation ID and private key', () => {
    expect(readGitHubReviewAppConfig({
      GITHUB_REVIEW_APP_ID: '5864885',
      GITHUB_REVIEW_INSTALLATION_ID: '12345678',
      GITHUB_REVIEW_APP_PRIVATE_KEY: config.privateKey,
    })).not.toBeNull();
    expect(readGitHubReviewAppConfig({
      GITHUB_REVIEW_APP_ID: 'wrong',
      GITHUB_REVIEW_INSTALLATION_ID: '12345678',
      GITHUB_REVIEW_APP_PRIVATE_KEY: config.privateKey,
    })).toBeNull();
  });

  it('creates a short-lived RS256 App JWT', () => {
    const jwt = createGitHubAppJwt(config, 1_800_000_000);
    expect(jwt.split('.')).toHaveLength(3);
    expect(Buffer.from(jwt.split('.')[1], 'base64url').toString()).toContain('"iss":"5864885"');
  });

  it('fails closed when the PR head has changed and never posts a review', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push((init?.method ?? 'GET') + ' ' + url);
      if (url.endsWith('/access_tokens')) return response({ token: 'installation-token' });
      return response({ state: 'open', head: { sha: 'b'.repeat(40) } });
    }) as typeof fetch;

    const result = await submitOwnerApprovedGitHubReview({
      pullRequestNumber: 42, expectedHeadSha: sha,
      ownerApprovalVerified: true, approvalEventId,
    }, config, fetcher);
    expect(result).toEqual({ status: 'blocked', reason: 'head_sha_mismatch' });
    expect(calls.some((call) => call.includes('/reviews'))).toBe(false);
  });

  it('submits an approval anchored to the exact verified head SHA', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/access_tokens')) return response({ token: 'installation-token' });
      if (url.endsWith('/pulls/42')) return response({ state: 'open', head: { sha } });
      return response({ id: 987 });
    }) as typeof fetch;

    const result = await submitOwnerApprovedGitHubReview({
      pullRequestNumber: 42, expectedHeadSha: sha,
      ownerApprovalVerified: true, approvalEventId,
    }, config, fetcher);
    expect(result).toEqual({ status: 'submitted', reviewId: 987, commitSha: sha });
    const post = calls.find((call) => call.url.endsWith('/pulls/42/reviews'));
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ event: 'APPROVE', commit_id: sha });
  });

  it('rejects an unverified owner approval before contacting GitHub', async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return response({}); }) as typeof fetch;
    const result = await submitOwnerApprovedGitHubReview({
      pullRequestNumber: 42, expectedHeadSha: sha,
      ownerApprovalVerified: false as true, approvalEventId,
    }, config, fetcher);
    expect(result).toEqual({ status: 'blocked', reason: 'invalid_request' });
    expect(calls).toBe(0);
  });
});
