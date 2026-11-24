import { describe, expect, it } from 'vitest';
import { getWorkforceContractSnapshot } from './workforceRuntime.js';

describe('RyanAI workforce contract', () => {
  it('requires exactly thirteen module agents and ten specialist workers', () => {
    const snapshot = getWorkforceContractSnapshot();
    expect(snapshot.contractValid).toBe(true);
    expect(snapshot.moduleAgentCount).toBe(13);
    expect(snapshot.workerCount).toBe(10);
    expect(new Set(snapshot.moduleAgentIds).size).toBe(13);
    expect(new Set(snapshot.workerIds).size).toBe(10);
  });
});
