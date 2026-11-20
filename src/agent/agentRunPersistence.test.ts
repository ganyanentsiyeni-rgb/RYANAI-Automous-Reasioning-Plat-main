import { describe, expect, it } from 'vitest';
import { buildPAExecutionReceiptResult, requirePADelegationForCompletion, requirePADelegationRecord } from './agentRunPersistence.js';

describe('PA execution receipt upsert result parity', () => {
  it('preserves capability receipts and exact repository snapshot for both upsert branches', () => {
    const snapshot = {
      repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
      commitSha: 'a'.repeat(40),
      inspectedAt: '2026-11-19T17:00:00.000Z',
      source: 'github-oauth-read-only' as const,
    };
    const capabilityReceipts = [{
      capability: 'repository.inspect' as const,
      status: 'passed' as const,
      evidenceReferences: ['agent-run-evidence:evidence-1'],
      repositoryInspection: snapshot,
    }];
    const plan = { synthesis: 'verified snapshot', degraded: false, verification: { verified: true, reason: null }, capabilityReceipts };

    // Both Prisma upsert branches call this same builder; neither can silently omit audit metadata.
    const createResult = buildPAExecutionReceiptResult(plan, snapshot);
    const updateResult = buildPAExecutionReceiptResult(plan, snapshot);

    expect(createResult).toEqual(updateResult);
    expect(createResult.capabilityReceipts).toEqual(capabilityReceipts);
    expect(createResult.repositoryInspection).toEqual(snapshot);
    expect(createResult.verification).toEqual({ verified: true, reason: null });
  });

  it('uses explicit empty receipts and null snapshot when no inspection was performed', () => {
    expect(buildPAExecutionReceiptResult({ synthesis: 'ordinary run', degraded: false }, null)).toEqual({
      synthesis: 'ordinary run', degraded: false,
      verification: { verified: false, reason: 'Verification evidence was not supplied.' },
      capabilityReceipts: [], repositoryInspection: null,
    });
  });
});


describe('PA delegation completion guard', () => {
  it('refuses successful completion when the referenced delegation no longer exists', () => {
    expect(() => requirePADelegationForCompletion(null)).toThrow(
      'PA delegation record is missing; completion receipt cannot be persisted.',
    );
  });

  it('refuses a terminal transition when the referenced delegation no longer exists', () => {
    expect(() => requirePADelegationRecord(null)).toThrow(
      'PA delegation record is missing; terminal receipt cannot be persisted.',
    );
  });

  it('returns the exact persisted delegation identity for receipt linkage', () => {
    const delegation = { id: 'delegation-1', traceId: 'trace-1' };
    expect(requirePADelegationForCompletion(delegation)).toBe(delegation);
    expect(requirePADelegationRecord(delegation)).toBe(delegation);
  });
});
