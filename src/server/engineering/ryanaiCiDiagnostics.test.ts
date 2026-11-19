import { describe, expect, it } from 'vitest';
import { analyzeRyanAICiEvidence } from './ryanaiCiDiagnostics.js';

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
