export type ReasoningBrain = 'primary' | 'secondary' | 'logic';

/**
 * PA delegations seed Jarvis -> brain handoffs, while the legacy supervisor
 * path seeds supervisor -> brain handoffs. Both represent the same durable
 * brain execution edge and must be updated by the worker.
 */
export function getBrainHandoffRoute(brain: ReasoningBrain) {
  if (brain === 'logic') {
    return { toAgent: 'logic', status: { in: ['pending', 'running'] } } as const;
  }
  return {
    fromAgent: { in: ['supervisor', 'jarvis'] },
    toAgent: brain,
  } as const;
}
