import { analyzeRyanAICiEvidence, createRyanAICiProviderBlockedReport, createRyanAIVerifiedCiReport } from './ryanaiCiDiagnostics.js';
import type { ConnectedGitHubWorkflowEvidence } from '../routes/githubIntegration.js';
export interface RyanAICiDiagnosticsTask { id: string; input: unknown; requiredCapabilities: string[]; ownerUserId: string; }
export type RyanAICiEvidenceInspector = (ownerUserId: string, requestedHeadSha: string, options: { includeJobLogs: boolean; signal?: AbortSignal }) => Promise<ConnectedGitHubWorkflowEvidence>;
/** The owner identity comes from the persisted StudioTask row, never task input. */
export function createRyanAICiDiagnosticsTaskHandler(inspectEvidence: RyanAICiEvidenceInspector) {
  return async ({ task, signal }: { task: RyanAICiDiagnosticsTask; signal?: AbortSignal }) => {
    signal?.throwIfAborted();
    if (!task.requiredCapabilities.includes('read-workflow-runs')) throw new Error('CI diagnostics requires the explicit read-workflow-runs capability.');
    const input = task.input !== null && typeof task.input === 'object' && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
    const requestedHeadSha = typeof input.headSha === 'string' ? input.headSha : '';
    try {
      const evidence = await inspectEvidence(task.ownerUserId, requestedHeadSha, {
        includeJobLogs: task.requiredCapabilities.includes('read-job-logs'),
        ...(signal ? { signal } : {}),
      });
      const report = analyzeRyanAICiEvidence({ headSha: evidence.verifiedHeadSha, workflowRuns: evidence.workflowRuns.map((run) => ({ id: run.id, name: run.name, headSha: run.headSha, status: run.status, conclusion: run.conclusion, url: run.url })), jobLogs: evidence.jobLogExcerpts }, task.requiredCapabilities);
      return createRyanAIVerifiedCiReport(report, evidence);
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      return createRyanAICiProviderBlockedReport(/^[a-f0-9]{40}$/i.test(requestedHeadSha) ? requestedHeadSha.toLowerCase() : null, error);
    }
  };
}
