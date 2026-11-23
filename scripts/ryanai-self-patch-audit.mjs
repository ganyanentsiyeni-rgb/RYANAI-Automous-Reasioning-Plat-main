#!/usr/bin/env node
/**
 * RyanAI-only GitHub Actions, CI and repository-governance audit.
 * Read-only: no workflow dispatch, reruns, writes, deployments, branch changes,
 * secret reads, or environment mutations.
 */
const API = 'https://api.github.com';
const SENSITIVE_KEY = /(token|secret|password|authorization|private.?key|credential)/i;

export function classifyCheck(check) {
  if (!check || typeof check !== 'object') return 'missing';
  if (check.status !== 'completed') {
    if (['queued', 'requested', 'waiting', 'pending'].includes(check.status)) return 'queued';
    if (check.status === 'in_progress') return 'in_progress';
    return 'missing';
  }
  switch (check.conclusion) {
    case 'success': return 'passed';
    case 'failure': case 'timed_out': case 'startup_failure': case 'action_required': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'skipped': case 'neutral': case 'stale': return 'skipped';
    default: return 'missing';
  }
}
export function summarizeChecks(checkRuns = [], combinedState = 'unknown') {
  const checks = checkRuns.map((check) => ({
    name: String(check.name || 'unnamed'), status: classifyCheck(check),
    conclusion: check.conclusion ?? null, startedAt: check.started_at ?? null,
    completedAt: check.completed_at ?? null, detailsUrl: check.details_url ?? null,
  }));
  const counts = Object.fromEntries(['passed','failed','queued','in_progress','cancelled','skipped','missing']
    .map((state) => [state, checks.filter((check) => check.status === state).length]));
  let overall = 'pending';
  if (counts.failed > 0 || combinedState === 'failure' || combinedState === 'error') overall = 'failing';
  else if (checks.length > 0 && counts.passed === checks.length && combinedState === 'success') overall = 'passing';
  else if (checks.length === 0) overall = 'no-data';
  return { overall, combinedState, counts, checks };
}
export function redactEnvironment(values) {
  return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [
    key, SENSITIVE_KEY.test(key) ? { configured: Boolean(value), valueExposed: false } :
      { configured: value !== undefined && value !== '', valueExposed: false },
  ]));
}
export function classifyGovernanceResponse(status) {
  if (status === 200) return 'available';
  if (status === 403) return 'permission_blocked';
  if (status === 404) return 'not_found_or_hidden';
  if (status === 401) return 'unauthorized';
  return 'error';
}
async function github(path, token) {
  const response = await fetch(new URL(path, API), { headers: {
    accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  }});
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}
async function githubResponse(path, token) {
  const response = await fetch(new URL(path, API), { headers: {
    accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  }});
  return { status: response.status, data: response.ok ? await response.json() : null };
}
async function auditRepositoryGovernance(repository, adminToken) {
  const [protection, rulesets] = await Promise.all([
    githubResponse(`/repos/${repository}/branches/main/protection`, adminToken),
    githubResponse(`/repos/${repository}/rulesets?per_page=100`, adminToken),
  ]);
  const protectionState = classifyGovernanceResponse(protection.status);
  const rulesetsState = classifyGovernanceResponse(rulesets.status);
  const p = protection.data || {};
  const r = Array.isArray(rulesets.data) ? rulesets.data : [];
  return {
    readOnly: true,
    branchProtection: {
      state: protectionState, httpStatus: protection.status,
      ...(protectionState === 'available' ? {
        enforceAdmins: p.enforce_admins?.enabled ?? null,
        requiredApprovals: p.required_pull_request_reviews?.required_approving_review_count ?? null,
        dismissStaleReviews: p.required_pull_request_reviews?.dismiss_stale_reviews ?? null,
        codeOwnerReviews: p.required_pull_request_reviews?.require_code_owner_reviews ?? null,
        requiredStatusChecks: p.required_status_checks?.contexts ?? [],
        strictStatusChecks: p.required_status_checks?.strict ?? null,
        restrictionsEnabled: Boolean(p.restrictions),
      } : {}),
    },
    rulesets: {
      state: rulesetsState, httpStatus: rulesets.status,
      count: rulesetsState === 'available' ? r.length : null,
      items: rulesetsState === 'available' ? r.map((item) => ({
        id: item.id, name: item.name, target: item.target, enforcement: item.enforcement,
        source: item.source, ruleTypes: (item.rules || []).map((rule) => rule.type),
        bypassActors: (item.bypass_actors || []).map((actor) => ({
          actorId: actor.actor_id ?? null, actorType: actor.actor_type ?? null,
          bypassMode: actor.bypass_mode ?? null,
        })),
      })) : [],
    },
    note: '403 means the token lacks the required read permission; 404 means the resource may be absent or hidden by GitHub permission filtering. No governance settings are changed.',
  };
}
export async function runAudit({ repository, sha, token, adminToken, env = process.env }) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/repository.');
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('GITHUB_SHA must be a full commit SHA.');
  if (!token) throw new Error('A read-only GitHub token is required.');
  const [checkData, statusData, workflowsData, environmentsData] = await Promise.all([
    github(`/repos/${repository}/commits/${sha}/check-runs?per_page=100`, token),
    github(`/repos/${repository}/commits/${sha}/status`, token),
    github(`/repos/${repository}/actions/workflows?per_page=100`, token),
    github(`/repos/${repository}/environments?per_page=100`, token),
  ]);
  const [runsByWorkflow, variableInventory] = await Promise.all([
    Promise.all((workflowsData.workflows || []).map(async (workflow) => {
      const data = await github(`/repos/${repository}/actions/workflows/${workflow.id}/runs?per_page=5`, token);
      return { id: workflow.id, name: workflow.name, path: workflow.path, state: workflow.state,
        runs: (data.workflow_runs || []).map((run) => ({
          id: run.id, event: run.event, status: run.status, conclusion: run.conclusion,
          headSha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at, htmlUrl: run.html_url,
        })) };
    })),
    github(`/repos/${repository}/actions/variables?per_page=100`, token).catch(() => ({ variables: [], unavailable: true })),
  ]);
  const repositoryGovernance = adminToken
    ? await auditRepositoryGovernance(repository, adminToken)
    : { readOnly: true, state: 'missing_token', note: 'GH_ADMIN_TOKEN is not configured; governance was not inspected.' };
  return {
    schemaVersion: 2, generatedAt: new Date().toISOString(),
    scope: { repository, commitSha: sha, exclusions: ['Gen-X', 'Jarvis'] },
    permissions: 'read-only', ci: summarizeChecks(checkData.check_runs || [], statusData.state || 'unknown'),
    workflows: runsByWorkflow,
    environments: (environmentsData.environments || []).map((item) => ({
      name: item.name, protectionRules: (item.protection_rules || []).map((rule) => rule.type),
      waitTimer: item.wait_timer ?? null,
    })),
    repositoryGovernance,
    repositoryVariables: (variableInventory.variables || []).map(({ name }) => ({ name, valueExposed: false })),
    runtimeConfigurationPresence: redactEnvironment(env),
    limitations: [
      'GitHub Actions secrets and environment secret values are never read.',
      'Remote provider variable values are never read.',
      'Repository governance is inspected with GET requests only; no settings are changed.',
      'This audit does not dispatch, rerun, patch, merge, migrate, deploy, or mutate infrastructure.',
      'PA Agent and outbound Comms delivery require the separately approved integration adapter and destination/provider verification.',
    ],
  };
}
async function main() {
  const report = await runAudit({
    repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN, adminToken: process.env.GH_ADMIN_TOKEN,
  });
  const output = JSON.stringify(report, null, 2);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `overall=${report.ci.overall}\n`);
  }
  process.stdout.write(output + '\n');
  if (report.ci.overall === 'failing') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`RyanAI CI audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
