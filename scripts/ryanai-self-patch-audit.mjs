#!/usr/bin/env node
/**
 * RyanAI-only GitHub Actions and CI audit.
 * Read-only: no dispatch, reruns, writes, deployments, branch changes, secret reads, or mutations.
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
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
    case 'action_required': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'skipped':
    case 'neutral':
    case 'stale': return 'skipped';
    default: return 'missing';
  }
}

export function summarizeChecks(checkRuns = [], combinedState = 'unknown') {
  const checks = checkRuns.map((check) => ({
    name: String(check.name || 'unnamed'),
    status: classifyCheck(check),
    conclusion: check.conclusion ?? null,
    startedAt: check.started_at ?? null,
    completedAt: check.completed_at ?? null,
    detailsUrl: check.details_url ?? null,
  }));
  const counts = Object.fromEntries(
    ['passed', 'failed', 'queued', 'in_progress', 'cancelled', 'skipped', 'missing']
      .map((state) => [state, checks.filter((check) => check.status === state).length]),
  );
  let overall = 'pending';
  if (counts.failed > 0 || combinedState === 'failure' || combinedState === 'error') overall = 'failing';
  else if (checks.length > 0 && counts.passed === checks.length && combinedState === 'success') overall = 'passing';
  else if (checks.length === 0) overall = 'no-data';
  return { overall, combinedState, counts, checks };
}

export function redactEnvironment(values) {
  return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [
    key,
    SENSITIVE_KEY.test(key) ? { configured: Boolean(value), valueExposed: false } :
      { configured: value !== undefined && value !== '', valueExposed: false },
  ]));
}

async function github(path, token) {
  const response = await fetch(new URL(path, API), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error('GitHub API ' + response.status + ' for ' + path);
  return response.json();
}

async function inventory(path, token, key) {
  try {
    const data = await github(path, token);
    return { status: 'available', items: data[key] || [] };
  } catch (error) {
    return { status: 'unavailable', items: [], error: error.message };
  }
}

export async function runAudit({ repository, sha, token, env = process.env }) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/repository.');
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('GITHUB_SHA must be a full commit SHA.');
  if (!token) throw new Error('A read-only GitHub token is required.');
  const [checkData, statusData, workflowsData, environmentsInventory, variableInventory] = await Promise.all([
    github('/repos/' + repository + '/commits/' + sha + '/check-runs?per_page=100', token),
    github('/repos/' + repository + '/commits/' + sha + '/status', token),
    github('/repos/' + repository + '/actions/workflows?per_page=100', token),
    inventory('/repos/' + repository + '/environments?per_page=100', token, 'environments'),
    inventory('/repos/' + repository + '/actions/variables?per_page=100', token, 'variables'),
  ]);
  const runsByWorkflow = await Promise.all((workflowsData.workflows || []).map(async (workflow) => {
    try {
      const data = await github('/repos/' + repository + '/actions/workflows/' + workflow.id + '/runs?per_page=5', token);
      return {
        id: workflow.id, name: workflow.name, path: workflow.path, state: workflow.state,
        inventoryStatus: 'available',
        runs: (data.workflow_runs || []).map((run) => ({
          id: run.id, event: run.event, status: run.status, conclusion: run.conclusion,
          headSha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at, htmlUrl: run.html_url,
        })),
      };
    } catch (error) {
      return { id: workflow.id, name: workflow.name, path: workflow.path, state: workflow.state,
        inventoryStatus: 'unavailable', error: error.message, runs: [] };
    }
  }));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scope: { repository, commitSha: sha, exclusions: ['Gen-X', 'Jarvis'] },
    permissions: 'read-only',
    ci: summarizeChecks(checkData.check_runs || [], statusData.state || 'unknown'),
    workflows: { status: 'available', items: runsByWorkflow },
    environments: {
      status: environmentsInventory.status,
      items: environmentsInventory.items.map((item) => ({
        name: item.name,
        protectionRules: (item.protection_rules || []).map((rule) => rule.type),
        waitTimer: item.wait_timer ?? null,
      })),
      ...(environmentsInventory.error ? { error: environmentsInventory.error } : {}),
    },
    repositoryVariables: {
      status: variableInventory.status,
      items: variableInventory.items.map(({ name }) => ({ name, valueExposed: false })),
      ...(variableInventory.error ? { error: variableInventory.error } : {}),
    },
    runtimeConfigurationPresence: redactEnvironment(env),
    limitations: [
      'GitHub Actions secrets and environment secret values are never read.',
      'Remote provider variable values are never read.',
      'An unavailable inventory is reported as unavailable, never as an empty successful inventory.',
      'This audit does not dispatch, rerun, patch, merge, migrate, deploy, or mutate infrastructure.',
      'PA Agent and outbound Comms delivery require the separately approved RyanAI-only adapter and destination/provider verification.',
    ],
  };
}

async function main() {
  const report = await runAudit({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  });
  const output = JSON.stringify(report, null, 2);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'overall=' + report.ci.overall + '\n');
  }
  process.stdout.write(output + '\n');
  if (report.ci.overall === 'failing') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === 'file://' + process.argv[1]) {
  main().catch((error) => {
    process.stderr.write('RyanAI CI audit failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
