import { describe, expect, it } from 'vitest';
import { assertPACompletionCapabilityReceipts } from './paCapabilityCompletion.js';

const scope = { paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['repository.inspect', 'evidence.record'] };
const passed = (capability: 'repository.inspect' | 'evidence.record') => ({ capability, status: 'passed' as const, evidenceReferences: ['evidence:' + capability] });

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
