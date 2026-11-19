export type RyanAICiEvidenceState =
  | 'passed' | 'failed' | 'queued' | 'running' | 'cancelled'
  | 'skipped' | 'neutral' | 'missing' | 'unknown' | 'provider-blocked';

export interface RyanAICiWorkflowEvidence {
  id: string | number | null;
  name: string;
  headSha: string | null;
  status: RyanAICiEvidenceState;
  conclusion: string | null;
  url: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function classifyWorkflowRun(statusValue: unknown, conclusionValue: unknown): RyanAICiEvidenceState {
  const status = nonEmptyString(statusValue)?.toLowerCase();
  const conclusion = nonEmptyString(conclusionValue)?.toLowerCase() ?? null;
  if (status === 'queued' || status === 'pending' || status === 'requested' || status === 'waiting') return 'queued';
  if (status === 'in_progress' || status === 'in-progress') return 'running';
  if (status !== 'completed') return 'unknown';
  if (!conclusion) return 'missing';
  if (conclusion === 'success') return 'passed';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required' || conclusion === 'startup_failure') return 'failed';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion === 'skipped') return 'skipped';
  if (conclusion === 'neutral') return 'neutral';
  return 'unknown';
}

const LOG_SIGNATURES = [
  { id: 'typescript-error', pattern: /error TS\d{4}/i },
  { id: 'module-resolution-error', pattern: /cannot find module|module not found|failed to resolve import/i },
  { id: 'test-failure', pattern: /\b(test|tests|suite) failed\b|\bFAIL\b/i },
  { id: 'npm-command-error', pattern: /npm ERR!/i },
  { id: 'permission-error', pattern: /permission denied|EACCES/i },
  { id: 'network-or-provider-error', pattern: /ECONNRESET|ETIMEDOUT|ENOTFOUND|rate.?limit/i },
];

export function analyzeRyanAICiEvidence(input: unknown, requiredCapabilities: readonly string[] = []) {
  const payload = asRecord(input);
  if (!payload) throw new Error('CI diagnostics requires a structured workflow evidence object.');

  const rawRuns = Array.isArray(payload.workflowRuns) ? payload.workflowRuns : [];
  const headSha = nonEmptyString(payload.headSha);
  const workflowRuns: RyanAICiWorkflowEvidence[] = rawRuns.slice(0, 100).map((raw) => {
    const run = asRecord(raw);
    if (!run) return { id: null, name: 'Unknown workflow', headSha: null, status: 'unknown', conclusion: null, url: null };
    return {
      id: typeof run.id === 'string' || typeof run.id === 'number' ? run.id : null,
      name: nonEmptyString(run.name) ?? 'Unnamed workflow',
      headSha: nonEmptyString(run.headSha ?? run.head_sha),
      status: classifyWorkflowRun(run.status, run.conclusion),
      conclusion: nonEmptyString(run.conclusion)?.toLowerCase() ?? null,
      url: nonEmptyString(run.url ?? run.html_url),
    };
  });

  const counts = {
    passed: workflowRuns.filter((run) => run.status === 'passed').length,
    failed: workflowRuns.filter((run) => run.status === 'failed').length,
    queued: workflowRuns.filter((run) => run.status === 'queued').length,
    running: workflowRuns.filter((run) => run.status === 'running').length,
    cancelled: workflowRuns.filter((run) => run.status === 'cancelled').length,
    skipped: workflowRuns.filter((run) => run.status === 'skipped').length,
    neutral: workflowRuns.filter((run) => run.status === 'neutral').length,
    missing: workflowRuns.filter((run) => run.status === 'missing').length,
    unknown: workflowRuns.filter((run) => run.status === 'unknown').length,
    providerBlocked: workflowRuns.filter((run) => run.status === 'provider-blocked').length,
  };

  const rawLogs = Array.isArray(payload.jobLogs) ? payload.jobLogs : [];
  const logsAuthorized = requiredCapabilities.includes('read-job-logs');
  const logEvidence = logsAuthorized
    ? rawLogs.slice(0, 100).flatMap((raw) => {
        const log = asRecord(raw);
        const excerpt = nonEmptyString(log?.excerpt ?? log?.text);
        if (!log || !excerpt) return [];
        return [{
          runId: typeof log.runId === 'string' || typeof log.runId === 'number' ? log.runId : null,
          jobName: nonEmptyString(log.jobName) ?? 'Unknown job',
          signatures: LOG_SIGNATURES.filter((signature) => signature.pattern.test(excerpt)).map((signature) => signature.id),
          lineCount: excerpt.split(/\r?\n/).length,
          excerptReturned: false,
        }];
      })
    : [];

  return {
    kind: 'ci.diagnostics',
    schemaVersion: 1,
    source: 'task_input_snapshot',
    evidenceTrust: 'caller_supplied_unverified',
    liveProviderFetchPerformed: false,
    headSha,
    workflowRuns,
    counts,
    jobLogEvidence: {
      authorized: logsAuthorized,
      suppliedCount: rawLogs.length,
      analyzedCount: logEvidence.length,
      findings: logEvidence,
      rawLogTextReturned: false,
    },
    summary: workflowRuns.length === 0
      ? 'missing'
      : counts.failed > 0
        ? 'failures_observed'
        : counts.queued > 0 || counts.running > 0
          ? 'checks_incomplete'
          : counts.passed === workflowRuns.length
            ? 'all_observed_runs_passed'
            : 'mixed_or_insufficient_evidence',
    notes: [
      'Only completed runs with conclusion=success count as passed.',
      'Queued, pending, running, skipped, cancelled, missing and unknown states are not passes.',
      'This worker analyzes the task-supplied snapshot; it does not fetch GitHub data or verify snapshot provenance.',
      'Job log excerpts are never returned; only bounded signature metadata is emitted.',
    ],
  };
}


/** A provider/authentication failure is evidence of a blocked inspection, never a passing check. */
export function createRyanAICiProviderBlockedReport(headSha: string | null, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const reasonCode = /^github_[a-z0-9_]{1,96}$/.test(message)
    ? message
    : 'github_provider_request_failed';
  return {
    kind: 'ci.diagnostics',
    schemaVersion: 1,
    source: 'github-oauth-read-only',
    evidenceTrust: 'provider_blocked',
    headSha,
    workflowRuns: [],
    counts: {
      passed: 0, failed: 0, queued: 0, running: 0, cancelled: 0,
      skipped: 0, neutral: 0, missing: 0, unknown: 0, providerBlocked: 1,
    },
    jobLogEvidence: {
      authorized: false, suppliedCount: 0, analyzedCount: 0,
      findings: [], rawLogTextReturned: false,
    },
    summary: 'provider_blocked',
    providerBlock: { reasonCode },
    notes: [
      'GitHub evidence could not be verified; no workflow check is treated as passed.',
      'Reconnect or repair the existing owner-bound GitHub integration if the reason indicates missing or expired authorization.',
    ],
  };
}
