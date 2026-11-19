import type { StudioWorkerContext } from './studioNativeCore.js';
import {
  analyzeRyanAICiEvidence,
  createRyanAICiProviderBlockedReport,
} from './ryanaiCiDiagnostics.js';

export interface RyanAIVerifiedGitHubCiEvidence {
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
    jobs: Array<{ id: number; name: string; status: string; conclusion: string | null }>;
  }>;
  jobLogExcerpts: Array<{ runId: number; jobName: string; excerpt: string; lineCount: number }>;
  jobLogStatus: 'not_requested' | 'complete' | 'partial' | 'unavailable';
  complete: boolean;
}

export type RyanAIGitHubEvidenceInspector = (
  ownerUserId: string,
  requestedHeadSha: string,
  options: { includeJobLogs: boolean },
) => Promise<RyanAIVerifiedGitHubCiEvidence>;

/**
 * Builds a real Studio task handler around the owner-bound, read-only GitHub
 * evidence adapter. Dependency injection keeps provider access testable while
 * the production entrypoint supplies the actual OAuth-backed inspector.
 */
export function createRyanAICiDiagnosticsTaskHandler(inspect: RyanAIGitHubEvidenceInspector) {
  return async ({ task }: StudioWorkerContext) => {
    const requiredCapabilities = task.requiredCapabilities ?? [];
    if (!requiredCapabilities.includes('read-workflow-runs')) {
      throw new Error('CI diagnostics requires the explicit read-workflow-runs capability.');
    }
    const input = task.input !== null && typeof task.input === 'object' && !Array.isArray(task.input)
      ? task.input as Record<string, unknown>
      : {};
    const requestedHeadSha = typeof input.headSha === 'string' ? input.headSha : '';
    if (!/^[a-f0-9]{40}$/i.test(requestedHeadSha)) {
      return createRyanAICiProviderBlockedReport(null, new Error('github_workflow_head_sha_invalid'));
    }

    try {
      const evidence = await inspect(
        task.ownerUserId,
        requestedHeadSha,
        { includeJobLogs: requiredCapabilities.includes('read-job-logs') },
      );
      if (
        evidence.requestedHeadSha.toLowerCase() !== requestedHeadSha.toLowerCase() ||
        evidence.verifiedHeadSha.toLowerCase() !== requestedHeadSha.toLowerCase()
      ) {
        throw new Error('github_workflow_head_sha_mismatch');
      }
      const analysis = analyzeRyanAICiEvidence({
        headSha: evidence.verifiedHeadSha,
        workflowRuns: evidence.workflowRuns.map((run) => ({
          id: run.id,
          name: run.name,
          headSha: run.headSha,
          status: run.status,
          conclusion: run.conclusion,
          url: run.url,
        })),
        jobLogs: evidence.jobLogExcerpts,
      }, requiredCapabilities);

      return {
        ...analysis,
        source: evidence.source,
        evidenceTrust: 'github_verified_exact_sha',
        repositoryFullName: evidence.repositoryFullName,
        requestedHeadSha: evidence.requestedHeadSha,
        verifiedHeadSha: evidence.verifiedHeadSha,
        inspectedAt: evidence.inspectedAt,
        snapshotComplete: evidence.complete,
        summary: !evidence.complete && analysis.summary === 'all_observed_runs_passed'
          ? 'checks_incomplete'
          : analysis.summary,
        jobLogRetrievalStatus: evidence.jobLogStatus,
        liveProviderFetchPerformed: true,
        jobs: evidence.workflowRuns.map((run) => ({
          runId: run.id,
          workflow: run.name,
          jobs: run.jobs,
        })),
        notes: [
          ...analysis.notes.filter((note) =>
            note !== 'This worker analyzes the task-supplied snapshot; it does not fetch GitHub data or verify snapshot provenance.',
          ),
          'The requested commit SHA was verified against GitHub before its workflow evidence was retrieved.',
          'Workflow run and job metadata were fetched read-only from the owner-bound GitHub connection.',
          evidence.complete
            ? 'Workflow and job metadata pagination completed within the configured bounds.'
            : 'Workflow or job metadata is partial because configured pagination bounds were reached or unexpected records were filtered.',
          evidence.jobLogStatus === 'not_requested'
            ? 'Job logs were not requested; the read-job-logs capability was not present.'
            : 'Job-log retrieval status: ' + evidence.jobLogStatus + '. Raw log text is never included in this report.',
        ],
      };
    } catch (error) {
      return createRyanAICiProviderBlockedReport(requestedHeadSha.toLowerCase(), error);
    }
  };
}
