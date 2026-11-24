import { describe, expect, it } from 'vitest';
import { assertPACompletionCapabilityReceipts, assertPARepositoryInspectionEvidence } from './paCapabilityCompletion.js';

const scope = { paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['repository.inspect', 'evidence.record'] };
const passed = (capability: 'repository.inspect' | 'evidence.record' | 'comms.task.create') => ({ capability, status: 'passed' as const, evidenceReferences: ['evidence:' + capability], ...(capability === 'comms.task.create' ? { childRunId: 'pa_comms_' + 'a'.repeat(64) } : {}) });

describe('PA finalization capability receipts', () => {
  it('does not allow reasoning-only completion without capability receipts', () => {
    expect(() => assertPACompletionCapabilityReceipts(scope, [])).toThrow(/missing capability receipts/);
  });
  it('requires every approved capability to have a passed evidence-backed receipt', () => {
    expect(() => assertPACompletionCapabilityReceipts(scope, [passed('repository.inspect')])).toThrow(/evidence.record/);
    expect(() => assertPACompletionCapabilityReceipts(scope, [passed('repository.inspect'), { capability: 'evidence.record', status: 'queued', evidenceReferences: ['evidence:queued'] }])).toThrow(/no passed, evidence-backed receipt/);
    expect(() => assertPACompletionCapabilityReceipts(scope, [passed('repository.inspect'), { capability: 'evidence.record', status: 'passed', evidenceReferences: [] }])).toThrow(/no passed, evidence-backed receipt/);
  });
  it('accepts exact complete capability receipts only', () => {
    expect(() => assertPACompletionCapabilityReceipts(scope, [passed('repository.inspect'), passed('evidence.record')])).not.toThrow();
    expect(() => assertPACompletionCapabilityReceipts(scope, [passed('repository.inspect'), passed('evidence.record'), passed('evidence.record')])).toThrow(/unexpected or duplicate/);
  });
  it('does not change ordinary non-PA worker completion', () => {
    expect(() => assertPACompletionCapabilityReceipts({ ordinary: true }, [])).not.toThrow();
  });
});


describe('PA repository inspection evidence linkage', () => {
  const snapshot = {
    repositoryFullName: 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main',
    commitSha: 'a'.repeat(40),
    inspectedAt: '2026-11-19T17:00:00.000Z',
    source: 'github-oauth-read-only' as const,
  };
  const receipt = {
    capability: 'repository.inspect' as const,
    status: 'passed' as const,
    evidenceReferences: ['agent-run-evidence:evidence-1'],
    repositoryInspection: snapshot,
  };
  const event = {
    id: 'evidence-1',
    eventType: 'pa.capability.executed',
    payload: { capability: 'repository.inspect', ...snapshot, readOnly: true },
  };

  it('accepts only the exact snapshot represented by its evidence event', () => {
    expect(() => assertPARepositoryInspectionEvidence([receipt], [event])).not.toThrow();
  });
  it('rejects a missing evidence event', () => {
    expect(() => assertPARepositoryInspectionEvidence([receipt], [])).toThrow(/does not match/);
  });
  it('rejects a mismatched commit SHA even when the receipt says passed', () => {
    expect(() => assertPARepositoryInspectionEvidence(
      [{ ...receipt, repositoryInspection: { ...snapshot, commitSha: 'b'.repeat(40) } }],
      [event],
    )).toThrow(/does not match/);
  });
  it('rejects missing or malformed snapshot metadata', () => {
    expect(() => assertPARepositoryInspectionEvidence(
      [{ ...receipt, repositoryInspection: undefined }],
      [event],
    )).toThrow(/metadata or evidence reference is missing/);
  });
});


describe('PA internal Comms child-task receipts', () => {
  const commsScope = { paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['comms.task.create'] };
  it('requires a durable child task ID for Comms task creation', () => {
    expect(() => assertPACompletionCapabilityReceipts(commsScope, [{
      capability: 'comms.task.create', status: 'passed', evidenceReferences: ['agent-run-evidence:evidence-1'],
    }])).toThrow(/durable child task reference/);
  });
  it('accepts a passed, evidence-backed internal Comms child task', () => {
    expect(() => assertPACompletionCapabilityReceipts(commsScope, [passed('comms.task.create')])).not.toThrow();
  });
});
