import { describe, expect, it } from 'vitest';
import { analyzeRyanAICiEvidence } from './ryanaiCiDiagnostics.js';
import { analyzeRyanAICiEvidence, createRyanAICiProviderBlockedReport, createRyanAIVerifiedCiReport } from './ryanaiCiDiagnostics.js';

describe('RyanAI CI evidence diagnostics', () => {
  it('keeps queued, skipped, cancelled and missing distinct from passed', () => {
    const report = analyzeRyanAICiEvidence({
      headSha: 'abc123',
      workflowRuns: [
        { id: 1, name: 'build', status: 'completed', conclusion: 'success' },
        { id: 2, name: 'security', status: 'queued' },
        { id: 3, name: 'docs', status: 'completed', conclusion: 'skipped' },
        { id: 4, name: 'tests', status: 'completed', conclusion: 'cancelled' },
        { id: 5, name: 'lint', status: 'completed' },
      ],
    });
    expect(report.counts).toMatchObject({ passed: 1, queued: 1, skipped: 1, cancelled: 1, missing: 1 });
    expect(report.summary).toBe('checks_incomplete');
  });

  it('only reports failures from completed runs with failure conclusions', () => {
    const report = analyzeRyanAICiEvidence({
      workflowRuns: [
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'waiting', status: 'in_progress' },
      ],
    });
    expect(report.counts.failed).toBe(1);
    expect(report.counts.running).toBe(1);
    expect(report.summary).toBe('failures_observed');
  });

  it('does not analyze or return log excerpts without read-job-logs capability', () => {
    const report = analyzeRyanAICiEvidence({
      workflowRuns: [],
      jobLogs: [{ jobName: 'test', excerpt: 'FAIL test suite' }],
    });
    expect(report.jobLogEvidence).toMatchObject({
      authorized: false, suppliedCount: 1, analyzedCount: 0, rawLogTextReturned: false,
    });
  });

  it('emits bounded signature metadata without returning raw logs when authorized', () => {
    const report = analyzeRyanAICiEvidence({
      workflowRuns: [],
      jobLogs: [{ runId: 7, jobName: 'typecheck', excerpt: 'error TS2322: type mismatch\nFAIL suite' }],
    }, ['read-job-logs']);
    expect(report.jobLogEvidence).toMatchObject({
      authorized: true, analyzedCount: 1, rawLogTextReturned: false,
    });
    expect(report.jobLogEvidence.findings[0].signatures).toEqual(['typescript-error', 'test-failure']);
    expect(JSON.stringify(report)).not.toContain('type mismatch');
  });

  it('rejects non-object task evidence', () => {
    expect(() => analyzeRyanAICiEvidence(null)).toThrow('structured workflow evidence');
  });
});


describe('RyanAI CI provider-blocked evidence', () => {
  it('records missing owner authorization as blocked, never passed', () => {
    const report = createRyanAICiProviderBlockedReport(
      'f'.repeat(40),
      new Error('github_owner_reauthorization_required'),
    );
    expect(report.summary).toBe('provider_blocked');
    expect(report.evidenceTrust).toBe('provider_blocked');
    expect(report.counts).toMatchObject({ providerBlocked: 1, passed: 0, failed: 0 });
    expect(report.providerBlock).toEqual({
      reasonCode: 'github_owner_reauthorization_required',
    });
  });

  it('does not expose arbitrary provider exception text', () => {
    const report = createRyanAICiProviderBlockedReport(
      null,
      new Error('Authorization: Bearer secret-value'),
    );
    expect(report.providerBlock.reasonCode).toBe('github_provider_request_failed');
    expect(JSON.stringify(report)).not.toContain('secret-value');
  });
});


describe('verified GitHub CI report composition', () => {
  it('replaces snapshot-only trust claims with exact-head provider provenance', () => {
    const analysis = analyzeRyanAICiEvidence({
      headSha: 'a'.repeat(40),
      workflowRuns: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success' }],
      jobLogs: [{ runId: 1, jobName: 'typecheck', excerpt: 'error TS2322: hidden raw detail' }],
    }, ['read-job-logs']);
    const report = createRyanAIVerifiedCiReport(analysis, {
      source: 'github-oauth-read-only',
      repositoryFullName: 'owner/repository',
      requestedHeadSha: 'a'.repeat(40),
      verifiedHeadSha: 'a'.repeat(40),
      inspectedAt: '2026-11-19T00:00:00.000Z',
      complete: false,
      jobLogStatus: 'partial',
      workflowRuns: [{
        id: 1, name: 'build',
        jobs: [{ id: 2, name: 'typecheck', status: 'completed', conclusion: 'failure' }],
      }],
    });
    expect(report).toMatchObject({
      source: 'github-oauth-read-only',
      evidenceTrust: 'github_verified_exact_sha',
      requestedHeadSha: 'a'.repeat(40),
      verifiedHeadSha: 'a'.repeat(40),
      snapshotComplete: false,
      jobLogRetrievalStatus: 'partial',
      liveProviderFetchPerformed: true,
      jobs: [{ runId: 1, workflow: 'build', jobs: [{ id: 2 }] }],
    });
    expect(report.notes.join(' ')).not.toContain('task-supplied snapshot');
    expect(report.notes.join(' ')).toContain('metadata is partial');
    expect(JSON.stringify(report)).not.toContain('hidden raw detail');
  });
});
