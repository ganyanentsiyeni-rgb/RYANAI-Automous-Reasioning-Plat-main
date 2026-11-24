import { describe, expect, it, vi } from 'vitest';
import { createRyanAICiDiagnosticsTaskHandler, registerRyanAICiDiagnosticsTaskHandlers } from './ryanaiCiDiagnosticsTask.js';
import { getStudioWorkerHandlerReadiness } from './studioNativeCore.js';
import type { ConnectedGitHubWorkflowEvidence } from '../routes/githubIntegration.js';
const sha = 'a'.repeat(40);
const task = (overrides: Record<string, unknown> = {}) => ({ id: 'task-1', ownerUserId: 'persisted-owner', input: { headSha: sha, ownerUserId: 'untrusted-input-owner' }, requiredCapabilities: ['read-workflow-runs'], ...overrides });
const evidence = (overrides: Partial<ConnectedGitHubWorkflowEvidence> = {}): ConnectedGitHubWorkflowEvidence => ({ repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main', requestedHeadSha: sha, verifiedHeadSha: sha, source: 'github-oauth-read-only', inspectedAt: '2026-11-19T18:00:00.000Z', complete: true, jobLogStatus: 'not_requested', workflowRuns: [{ id: 10, name: 'CI', headSha: sha, status: 'completed', conclusion: 'success', url: null, jobs: [] }], jobLogExcerpts: [], ...overrides });
describe('RyanAI CI diagnostics task pipeline', () => {
 it('registers all CI task aliases through the shared worker handler boundary', () => {
  const unregister = registerRyanAICiDiagnosticsTaskHandlers(async () => evidence());
  try {
   const readiness = getStudioWorkerHandlerReadiness('ci-diagnostics');
   expect(readiness.ready).toBe(true);
   expect(readiness.registeredTaskTypes).toEqual(expect.arrayContaining(['ci-failure', 'test-failure', 'build-failure']));
  } finally {
   unregister();
  }
 });

 it('uses persisted task owner and verified exact SHA', async () => { const inspect=vi.fn().mockResolvedValue(evidence()); const output=await createRyanAICiDiagnosticsTaskHandler(inspect)({task:task()}); expect(inspect).toHaveBeenCalledWith('persisted-owner',sha,{includeJobLogs:false}); expect(output).toMatchObject({evidenceTrust:'github_verified_exact_sha',requestedHeadSha:sha,verifiedHeadSha:sha}); expect(output.counts.passed).toBe(1); });
 it('forwards worker cancellation to the evidence inspector', async () => {
  const controller = new AbortController();
  const inspect = vi.fn().mockResolvedValue(evidence());
  await createRyanAICiDiagnosticsTaskHandler(inspect)({ task: task(), signal: controller.signal });
  expect(inspect).toHaveBeenCalledWith('persisted-owner', sha, { includeJobLogs: false, signal: controller.signal });
 });
 it('propagates cancellation instead of recording it as provider-blocked evidence', async () => {
  const controller = new AbortController();
  const inspect = vi.fn(async () => {
   controller.abort(new Error('worker shutdown during GitHub request'));
   throw new Error('worker shutdown during GitHub request');
  });
  await expect(createRyanAICiDiagnosticsTaskHandler(inspect)({ task: task(), signal: controller.signal })).rejects.toThrow('worker shutdown during GitHub request');
  expect(inspect).toHaveBeenCalledOnce();
 });
 it('requests job logs only with explicit capability', async () => { const inspect=vi.fn().mockResolvedValue(evidence()); const handler=createRyanAICiDiagnosticsTaskHandler(inspect); await handler({task:task()}); expect(inspect).toHaveBeenLastCalledWith('persisted-owner',sha,{includeJobLogs:false}); await handler({task:task({requiredCapabilities:['read-workflow-runs','read-job-logs']})}); expect(inspect).toHaveBeenLastCalledWith('persisted-owner',sha,{includeJobLogs:true}); });
 it('fails closed when workflow-read capability is absent', async () => { const inspect=vi.fn(); await expect(createRyanAICiDiagnosticsTaskHandler(inspect)({task:task({requiredCapabilities:[]})})).rejects.toThrow('explicit read-workflow-runs capability'); expect(inspect).not.toHaveBeenCalled(); });
 it('records provider-blocked without manufacturing passes', async () => { const inspect=vi.fn().mockRejectedValue(new Error('github_owner_connection_missing_or_wrong_repository')); const output=await createRyanAICiDiagnosticsTaskHandler(inspect)({task:task()}); expect(output).toMatchObject({evidenceTrust:'provider_blocked',summary:'provider_blocked',counts:{passed:0,failed:0,providerBlocked:1}}); });
 it('persists only sanitized evidence metadata for partial log retrieval', async () => { const inspect=vi.fn().mockResolvedValue(evidence({complete:false,jobLogStatus:'partial',jobLogExcerpts:[{runId:10,jobName:'test',excerpt:'typescript-error',lineCount:2}]})); const output=await createRyanAICiDiagnosticsTaskHandler(inspect)({task:task({requiredCapabilities:['read-workflow-runs','read-job-logs']})}); expect(JSON.stringify(output)).not.toContain('synthetic-secret'); expect(output).toMatchObject({snapshotComplete:false,jobLogRetrievalStatus:'partial'}); });
 it('keeps queued and skipped separate from passed', async () => { const inspect=vi.fn().mockResolvedValue(evidence({workflowRuns:[{id:1,name:'queued',headSha:sha,status:'queued',conclusion:null,url:null,jobs:[]},{id:2,name:'skipped',headSha:sha,status:'completed',conclusion:'skipped',url:null,jobs:[]}]})); const output=await createRyanAICiDiagnosticsTaskHandler(inspect)({task:task()}); expect(output.counts).toMatchObject({passed:0,queued:1,skipped:1}); expect(output.summary).toBe('checks_incomplete'); });
});
