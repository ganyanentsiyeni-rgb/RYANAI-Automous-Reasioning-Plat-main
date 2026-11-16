import { describe, expect, it } from 'vitest';
import { getBrainHandoffRoute } from './agentRunHandoffRouting.js';

describe('PA and supervisor handoff routing', () => {
  it('matches both legacy supervisor and PA Jarvis brain handoffs', () => {
    expect(getBrainHandoffRoute('primary')).toEqual({
      fromAgent: { in: ['supervisor', 'jarvis'] },
      toAgent: 'primary',
    });
    expect(getBrainHandoffRoute('secondary')).toEqual({
      fromAgent: { in: ['supervisor', 'jarvis'] },
      toAgent: 'secondary',
    });
  });

  it('updates all pending/running logic handoffs from the reasoning branches', () => {
    expect(getBrainHandoffRoute('logic')).toEqual({
      toAgent: 'logic',
      status: { in: ['pending', 'running'] },
    });
  });
});
