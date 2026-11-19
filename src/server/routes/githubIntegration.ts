import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { mapPullRequestReviewProvenance, type GraphQLPullRequestReviewPayload } from '../githubReviewProvenance.js';
import { requireUser } from './auth.js';
import {
  buildGitHubAuthorizationUrl,
  createGitHubOAuthState,
  decryptGitHubSecret,
  encryptGitHubSecret,
  GITHUB_API_VERSION,
  GITHUB_APP_REPOSITORY,
  getGitHubReturnUrl,
  githubOAuthStateHash,
  parseGitHubTokenTimes,
  readGitHubAppConfig,
  type GitHubAppConfig,
} from '../githubAppOAuth.js';

type GitHubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

type GitHubUser = { id?: number; login?: string; avatar_url?: string };
type GitHubRepository = { id?: number; name?: string; full_name?: string; html_url?: string; private?: boolean; pushed_at?: string; default_branch?: string; permissions?: Record<string, boolean> };
type StoredConnection = {
  userId: string;
  githubUserId: string;
  githubLogin: string;
  repositoryId: string;
  repositoryFullName: string;
  repositoryPermissions: unknown;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  connectedAt: Date;
  updatedAt: Date;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

class GitHubOAuthError extends Error {
  constructor(readonly publicCode: string) {
    super(publicCode);
    this.name = 'GitHubOAuthError';
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

async function exchangeGitHubCode(
  config: GitHubAppConfig,
  code: string,
  codeVerifier: string,
): Promise<GitHubTokenResponse> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.callbackUrl,
    code_verifier: codeVerifier,
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new GitHubOAuthError('github_token_exchange_failed');
  }
  return payload as GitHubTokenResponse;
}

async function refreshGitHubToken(config: GitHubAppConfig, refreshToken: string): Promise<GitHubTokenResponse> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new GitHubOAuthError('github_token_refresh_failed');
  }
  return payload as GitHubTokenResponse;
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch('https://api.github.com/' + path.replace(/^\/+/, ''), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + accessToken,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new GitHubOAuthError('github_repository_verification_failed');
  return await response.json() as T;
}

async function githubGraphQL<T>(
  query: string,
  variables: Record<string, string | number>,
  accessToken: string,
): Promise<T> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response);
  if (!response.ok || Array.isArray(payload.errors) || !payload.data) {
    throw new GitHubOAuthError('github_review_provenance_unavailable');
  }
  return payload.data as T;
}

async function revokeGitHubGrant(config: GitHubAppConfig, accessToken: string): Promise<boolean> {
  try {
    const basic = Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64');
    const response = await fetch(
      'https://api.github.com/applications/' + encodeURIComponent(config.clientId) + '/grant',
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Basic ' + basic,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

async function claimOAuthState(fastify: FastifyInstance, state: string) {
  const stateHash = githubOAuthStateHash(state);
  const now = new Date();
  const pending = await fastify.prisma.gitHubOAuthState.findUnique({ where: { stateHash } });
  if (!pending || pending.expiresAt.getTime() <= now.getTime()) {
    if (pending) await fastify.prisma.gitHubOAuthState.deleteMany({ where: { stateHash } });
    return null;
  }
  const claimed = await fastify.prisma.gitHubOAuthState.deleteMany({
    where: { stateHash, expiresAt: { gt: now } },
  });
  return claimed.count === 1 ? pending : null;
}

async function getUsableAccessToken(
  fastify: Pick<FastifyInstance, 'prisma'>,
  config: GitHubAppConfig,
  connection: StoredConnection,
): Promise<string | null> {
  try {
    const now = new Date();
    if (!connection.accessTokenExpiresAt ||
        connection.accessTokenExpiresAt.getTime() > now.getTime() + REFRESH_SKEW_MS) {
      return decryptGitHubSecret(connection.encryptedAccessToken, config.encryptionKey);
    }
    if (!connection.encryptedRefreshToken ||
        (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt.getTime() <= now.getTime())) {
      return null;
    }

    const refreshToken = decryptGitHubSecret(connection.encryptedRefreshToken, config.encryptionKey);
    const refreshed = await refreshGitHubToken(config, refreshToken);
    const tokenTimes = parseGitHubTokenTimes(refreshed);
    if (!refreshed.access_token || !refreshed.refresh_token ||
        !tokenTimes.accessTokenExpiresAt || !tokenTimes.refreshTokenExpiresAt) return null;

    const updated = await fastify.prisma.gitHubAppConnection.updateMany({
      where: { userId: connection.userId, encryptedRefreshToken: connection.encryptedRefreshToken },
      data: {
        encryptedAccessToken: encryptGitHubSecret(refreshed.access_token, config.encryptionKey),
        encryptedRefreshToken: encryptGitHubSecret(refreshed.refresh_token, config.encryptionKey),
        accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
        updatedAt: new Date(),
      },
    });
    if (updated.count === 1) return refreshed.access_token;

    // A concurrent status request may already have rotated the single-use
    // refresh token. Read the winner's replacement instead of reusing the old one.
    const latest = await fastify.prisma.gitHubAppConnection.findUnique({
      where: { userId: connection.userId },
    });
    if (!latest || (latest.accessTokenExpiresAt && latest.accessTokenExpiresAt.getTime() <= Date.now())) return null;
    return decryptGitHubSecret(latest.encryptedAccessToken, config.encryptionKey);
  } catch {
    // If another request rotated the one-use refresh token first, prefer its
    // newer encrypted row rather than falsely forcing this user to reconnect.
    try {
      const latest = await fastify.prisma.gitHubAppConnection.findUnique({
        where: { userId: connection.userId },
      });
      if (latest && latest.updatedAt.getTime() > connection.updatedAt.getTime() &&
          (!latest.accessTokenExpiresAt || latest.accessTokenExpiresAt.getTime() > Date.now() + REFRESH_SKEW_MS)) {
        return decryptGitHubSecret(latest.encryptedAccessToken, config.encryptionKey);
      }
    } catch {
      // Provider, database or decryption failure remains fail-closed.
    }
    return null;
  }
}


/**
 * Inspect only the repository already bound to this user's encrypted OAuth connection.
 * The function performs GitHub GET requests only and never accepts a repository or token
 * from an agent-supplied payload.
 */
export async function inspectConnectedGitHubRepository(
  fastify: Pick<FastifyInstance, 'prisma'>,
  userId: string,
): Promise<{
  repositoryFullName: string;
  repositoryUrl: string;
  accountLogin: string;
  defaultBranch: string;
  commitSha: string;
  commitUrl: string;
  inspectedAt: string;
  source: 'github-oauth-read-only';
}> {
  if (!userId.trim()) throw new GitHubOAuthError('github_owner_identity_missing');
  const config = readGitHubAppConfig();
  if (!config) throw new GitHubOAuthError('github_app_not_configured');
  const connection = await fastify.prisma.gitHubAppConnection.findUnique({ where: { userId } });
  if (!connection || connection.repositoryFullName !== GITHUB_APP_REPOSITORY) {
    throw new GitHubOAuthError('github_owner_connection_missing_or_wrong_repository');
  }
  // Worker inspection must not rotate or persist OAuth credentials. If the access token
  // is expired or inside the refresh window, fail closed and require the owner to reconnect.
  if (connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS) {
    throw new GitHubOAuthError('github_owner_reauthorization_required');
  }
  let accessToken: string;
  try {
    accessToken = decryptGitHubSecret(connection.encryptedAccessToken, config.encryptionKey);
  } catch {
    throw new GitHubOAuthError('github_owner_reauthorization_required');
  }

  const [account, repository] = await Promise.all([
    githubApi<GitHubUser>('user', accessToken),
    githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
  ]);
  if (
    String(account.id ?? '') !== connection.githubUserId ||
    typeof account.login !== 'string' || !account.login.trim() ||
    String(repository.id ?? '') !== connection.repositoryId ||
    repository.full_name !== GITHUB_APP_REPOSITORY ||
    repository.permissions?.pull !== true ||
    typeof repository.default_branch !== 'string' ||
    !repository.default_branch.trim()
  ) throw new GitHubOAuthError('github_owner_or_repository_verification_failed');

  const commit = await githubApi<{ sha?: string; html_url?: string }>(
    'repos/' + GITHUB_APP_REPOSITORY + '/commits/' + encodeURIComponent(repository.default_branch),
    accessToken,
  );
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
    throw new GitHubOAuthError('github_default_branch_commit_invalid');
  }
  return {
    repositoryFullName: GITHUB_APP_REPOSITORY,
    repositoryUrl: typeof repository.html_url === 'string' ? repository.html_url : 'https://github.com/' + GITHUB_APP_REPOSITORY,
    accountLogin: account.login,
    defaultBranch: repository.default_branch,
    commitSha: commit.sha,
    commitUrl: typeof commit.html_url === 'string'
      ? commit.html_url
      : 'https://github.com/' + GITHUB_APP_REPOSITORY + '/commit/' + commit.sha,
    inspectedAt: new Date().toISOString(),
    source: 'github-oauth-read-only',
  };
}

export interface ConnectedGitHubWorkflowEvidence {
  repositoryFullName: string;
  requestedHeadSha: string;
  verifiedHeadSha: string;
  source: 'github-oauth-read-only';
  inspectedAt: string;
  workflowRuns: Array<{
    id: number;
    name: string;
    headSha: string;
    status: string;
    conclusion: string | null;
    url: string | null;
    jobs: Array<{ name: string; status: string; conclusion: string | null }>;
  }>;
  complete: boolean;
}

/**
 * Fetch workflow-run and job metadata for one exact commit from the repository
 * already bound to the user's encrypted GitHub OAuth connection. GET only.
 * No log archives, workflow dispatches, token refreshes, or credential writes.
 */
export async function inspectConnectedGitHubWorkflowEvidence(
  fastify: Pick<FastifyInstance, 'prisma'>,
  userId: string,
  requestedHeadSha: string,
): Promise<ConnectedGitHubWorkflowEvidence> {
  if (!/^[a-f0-9]{40}$/i.test(requestedHeadSha)) {
    throw new GitHubOAuthError('github_workflow_head_sha_invalid');
  }
  const config = readGitHubAppConfig();
  if (!config) throw new GitHubOAuthError('github_app_not_configured');
  const connection = await fastify.prisma.gitHubAppConnection.findUnique({ where: { userId } });
  if (!connection || connection.repositoryFullName !== GITHUB_APP_REPOSITORY) {
    throw new GitHubOAuthError('github_owner_connection_missing_or_wrong_repository');
  }
  if (connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS) {
    throw new GitHubOAuthError('github_owner_reauthorization_required');
  }
  let accessToken: string;
  try {
    accessToken = decryptGitHubSecret(connection.encryptedAccessToken, config.encryptionKey);
  } catch {
    throw new GitHubOAuthError('github_owner_reauthorization_required');
  }

  const [account, repository, commit] = await Promise.all([
    githubApi<GitHubUser>('user', accessToken),
    githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
    githubApi<{ sha?: string }>(
      'repos/' + GITHUB_APP_REPOSITORY + '/commits/' + encodeURIComponent(requestedHeadSha),
      accessToken,
    ),
  ]);
  if (
    String(account.id ?? '') !== connection.githubUserId ||
    String(repository.id ?? '') !== connection.repositoryId ||
    repository.full_name !== GITHUB_APP_REPOSITORY ||
    repository.permissions?.pull !== true
  ) throw new GitHubOAuthError('github_owner_or_repository_verification_failed');
  if (typeof commit.sha !== 'string' || commit.sha.toLowerCase() !== requestedHeadSha.toLowerCase()) {
    throw new GitHubOAuthError('github_workflow_commit_sha_mismatch');
  }

  const runPayload = await githubApi<{
    total_count?: number;
    workflow_runs?: Array<{
      id?: number; name?: string; head_sha?: string; status?: string;
      conclusion?: string | null; html_url?: string;
    }>;
  }>(
    'repos/' + GITHUB_APP_REPOSITORY + '/actions/runs?head_sha=' +
      encodeURIComponent(requestedHeadSha) + '&per_page=50',
    accessToken,
  );
  const rawRuns = Array.isArray(runPayload.workflow_runs) ? runPayload.workflow_runs : [];
  const exactRuns = rawRuns.filter((run) =>
    typeof run.id === 'number' &&
    typeof run.head_sha === 'string' &&
    run.head_sha.toLowerCase() === requestedHeadSha.toLowerCase(),
  );
  const workflowRuns = await Promise.all(exactRuns.map(async (run) => {
    const jobsPayload = await githubApi<{
      total_count?: number;
      jobs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
    }>(
      'repos/' + GITHUB_APP_REPOSITORY + '/actions/runs/' +
        encodeURIComponent(String(run.id)) + '/jobs?per_page=100',
      accessToken,
    );
    const jobs = (Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : []).slice(0, 100)
      .map((job) => ({
        name: typeof job.name === 'string' ? job.name : 'Unnamed job',
        status: typeof job.status === 'string' ? job.status : 'unknown',
        conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
      }));
    return {
      id: run.id!,
      name: typeof run.name === 'string' ? run.name : 'Unnamed workflow',
      headSha: run.head_sha!,
      status: typeof run.status === 'string' ? run.status : 'unknown',
      conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
      url: typeof run.html_url === 'string' ? run.html_url : null,
      jobs,
    };
  }));

  return {
    repositoryFullName: GITHUB_APP_REPOSITORY,
    requestedHeadSha: requestedHeadSha.toLowerCase(),
    verifiedHeadSha: commit.sha.toLowerCase(),
    source: 'github-oauth-read-only',
    inspectedAt: new Date().toISOString(),
    workflowRuns,
    complete: rawRuns.length < 50 && exactRuns.length === rawRuns.length,
  };
}

export const githubIntegrationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/github/status', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ status: 'not_connected' });
    const config = readGitHubAppConfig();
    if (!config) return { status: 'not_configured', connected: false };

    const connection = await fastify.prisma.gitHubAppConnection.findUnique({ where: { userId } });
    if (!connection) return { status: 'not_connected', connected: false, configured: true };

    const accessToken = await getUsableAccessToken(fastify, config, connection as StoredConnection);
    if (!accessToken) {
      return {
        status: 'reauthorization_required',
        connected: false,
        account: { login: connection.githubLogin },
        repository: { fullName: connection.repositoryFullName },
      };
    }

    try {
      const [account, repository] = await Promise.all([
        githubApi<GitHubUser>('user', accessToken),
        githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
      ]);
      const verified = String(account.id ?? '') === connection.githubUserId
        && repository.full_name === GITHUB_APP_REPOSITORY
        && repository.permissions?.pull === true;
      if (!verified) {
        return {
          status: 'repository_access_missing',
          connected: false,
          account: typeof account.login === 'string'
            ? { login: account.login, avatarUrl: account.avatar_url }
            : undefined,
          repository: { fullName: GITHUB_APP_REPOSITORY, permissions: repository.permissions ?? {} },
        };
      }
      return {
        status: 'connected',
        connected: true,
        account: { login: account.login, avatarUrl: account.avatar_url },
        repository: { fullName: repository.full_name, permissions: repository.permissions ?? {} },
        accessTokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
      };
    } catch {
      return {
        status: 'unverified',
        connected: false,
        message: 'GitHub could not verify this connection. Try refreshing the status.',
      };
    }
  });

  fastify.get<{ Params: { pullNumber: string } }>(
    '/api/github/pull-requests/:pullNumber/review-provenance',
    { preHandler: requireUser },
    async (request, reply) => {
      const userId = request.authUser?.id;
      if (!userId) return reply.code(401).send({ status: 'unauthorized' });
      if (!/^\d{1,7}$/.test(request.params.pullNumber)) {
        return reply.code(400).send({ status: 'invalid_pull_request' });
      }
      const pullRequestNumber = Number(request.params.pullNumber);
      if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
        return reply.code(400).send({ status: 'invalid_pull_request' });
      }

      const config = readGitHubAppConfig();
      if (!config) return reply.code(503).send({ status: 'not_configured' });
      const connection = await fastify.prisma.gitHubAppConnection.findUnique({ where: { userId } });
      if (!connection) return reply.code(409).send({ status: 'not_connected' });
      const accessToken = await getUsableAccessToken(fastify, config, connection as StoredConnection);
      if (!accessToken) return reply.code(409).send({ status: 'reauthorization_required' });

      try {
        const [account, repository] = await Promise.all([
          githubApi<GitHubUser>('user', accessToken),
          githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
        ]);
        if (
          String(account.id ?? '') !== connection.githubUserId ||
          repository.full_name !== GITHUB_APP_REPOSITORY ||
          repository.permissions?.pull !== true
        ) return reply.code(403).send({ status: 'repository_access_not_verified' });

        const query = `
          query RyanAIReviewProvenance($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $number) {
                headRefOid
                reviews(first: 100) {
                  totalCount
                  pageInfo { hasNextPage }
                  nodes {
                    id
                    state
                    submittedAt
                    commit { oid }
                    author { __typename }
                    isCopilotCodeReview
                    copilotCodeReviewEffort
                    comments(first: 100) {
                      pageInfo { hasNextPage }
                      nodes {
                        id
                        isCopilotCodeReview
                        copilotCodeReviewSources { kind }
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        const [repositoryOwner, repositoryName] = GITHUB_APP_REPOSITORY.split('/');
        const data = await githubGraphQL<GraphQLPullRequestReviewPayload>(query, {
          owner: repositoryOwner,
          repo: repositoryName,
          number: pullRequestNumber,
        }, accessToken);
        const snapshot = mapPullRequestReviewProvenance(data, pullRequestNumber);
        if (!snapshot) return reply.code(404).send({ status: 'pull_request_not_found' });
        return { status: snapshot.complete ? 'available' : 'partial', ...snapshot };
      } catch {
        return reply.code(503).send({ status: 'github_review_provenance_unavailable' });
      }
    },
  );

  fastify.post('/api/github/connect', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in before connecting GitHub.' });
    const config = readGitHubAppConfig();
    if (!config) return reply.code(503).send({
      error: 'GitHub App registration and server-side encryption configuration are required.',
    });

    const oauth = createGitHubOAuthState();
    const now = new Date();
    await fastify.prisma.gitHubOAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
    await fastify.prisma.gitHubOAuthState.create({
      data: {
        stateHash: oauth.stateHash,
        userId,
        encryptedCodeVerifier: encryptGitHubSecret(oauth.codeVerifier, config.encryptionKey),
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      },
    });
    return {
      authorizationUrl: buildGitHubAuthorizationUrl(config, oauth.state, oauth.codeChallenge),
      expiresInSeconds: STATE_TTL_MS / 1000,
    };
  });

  // OAuth code and state arrive in the query string; keep them out of access logs.
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/github/callback',
    { logLevel: 'silent' },
    async (request, reply) => {
      const config = readGitHubAppConfig();
      if (!config) return reply.code(503).send({ error: 'GitHub App configuration is incomplete.' });
      const { code, state, error } = request.query ?? {};
      if (!state || state.length > 200) {
        return reply.code(400).send({ error: 'The GitHub authorization state is missing or invalid.' });
      }

      const pending = await claimOAuthState(fastify, state);
      if (!pending) {
        return reply.code(400).send({ error: 'The GitHub authorization state is expired or invalid. Start again from RyanAI.' });
      }
      if (error) return reply.redirect(getGitHubReturnUrl(config, 'denied'));
      if (!code || code.length > 2000) return reply.redirect(getGitHubReturnUrl(config, 'error'));

      let accessToken: string | undefined;
      try {
        const verifier = decryptGitHubSecret(pending.encryptedCodeVerifier, config.encryptionKey);
        const tokens = await exchangeGitHubCode(config, code, verifier);
        accessToken = tokens.access_token;
        const tokenTimes = parseGitHubTokenTimes(tokens);
        if (!accessToken || !tokens.refresh_token ||
            !tokenTimes.accessTokenExpiresAt || !tokenTimes.refreshTokenExpiresAt) {
          throw new GitHubOAuthError('github_expiring_token_required');
        }

        const [account, repository] = await Promise.all([
          githubApi<GitHubUser>('user', accessToken),
          githubApi<GitHubRepository>('repos/' + GITHUB_APP_REPOSITORY, accessToken),
        ]);
        if (!account.id || typeof account.login !== 'string' ||
            repository.full_name !== GITHUB_APP_REPOSITORY || repository.permissions?.pull !== true) {
          await revokeGitHubGrant(config, accessToken);
          accessToken = undefined;
          throw new GitHubOAuthError('github_repository_access_not_verified');
        }

        await fastify.prisma.gitHubAppConnection.upsert({
          where: { userId: pending.userId },
          create: {
            userId: pending.userId,
            githubUserId: String(account.id),
            githubLogin: account.login,
            repositoryId: String(repository.id ?? ''),
            repositoryFullName: GITHUB_APP_REPOSITORY,
            repositoryPermissions: repository.permissions ?? {},
            encryptedAccessToken: encryptGitHubSecret(accessToken, config.encryptionKey),
            encryptedRefreshToken: encryptGitHubSecret(tokens.refresh_token, config.encryptionKey),
            accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
          },
          update: {
            githubUserId: String(account.id),
            githubLogin: account.login,
            repositoryId: String(repository.id ?? ''),
            repositoryFullName: GITHUB_APP_REPOSITORY,
            repositoryPermissions: repository.permissions ?? {},
            encryptedAccessToken: encryptGitHubSecret(accessToken, config.encryptionKey),
            encryptedRefreshToken: encryptGitHubSecret(tokens.refresh_token, config.encryptionKey),
            accessTokenExpiresAt: tokenTimes.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokenTimes.refreshTokenExpiresAt,
            connectedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        return reply.redirect(getGitHubReturnUrl(config, 'connected'));
      } catch (cause) {
        if (accessToken) await revokeGitHubGrant(config, accessToken);
        request.log.warn({
          reason: cause instanceof GitHubOAuthError ? cause.publicCode : 'oauth_callback_failed',
        }, 'GitHub authorization was not completed');
        return reply.redirect(getGitHubReturnUrl(config, 'error'));
      }
    },
  );

  fastify.post('/api/github/disconnect', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) return reply.code(401).send({ error: 'Sign in before disconnecting GitHub.' });
    const connection = await fastify.prisma.gitHubAppConnection.findUnique({ where: { userId } });
    if (!connection) return { disconnected: true, remoteRevocation: 'not_needed' };

    let remoteRevoked = false;
    const config = readGitHubAppConfig();
    if (config) {
      try {
        const accessToken = await getUsableAccessToken(fastify, config, connection as StoredConnection);
        if (accessToken) remoteRevoked = await revokeGitHubGrant(config, accessToken);
      } catch {
        remoteRevoked = false;
      }
    }
    await fastify.prisma.gitHubAppConnection.deleteMany({ where: { userId } });
    return {
      disconnected: true,
      remoteRevocation: remoteRevoked ? 'confirmed' : 'unconfirmed',
    };
  });
};
