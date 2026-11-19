import { planExecution, type ExecutionChange, type ExecutionPlan } from './executionPlanner.js';

/**
 * Parse the persisted scope as untrusted data. Only explicit true values can
 * establish known/fresh state; malformed or absent fields remain conservative.
 */
export function parseAgentRunExecutionChange(value: unknown): ExecutionChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { eventKnown: false, snapshotFresh: false };
  }
  const candidate = value as Record<string, unknown>;
  const rawResourceKeys = candidate.resourceKeys;
  const hasResourceKeys = Array.isArray(rawResourceKeys);
  const resourceKeysValid = !hasResourceKeys || rawResourceKeys.every((key: unknown) => typeof key === 'string');
  const resourceKeys = hasResourceKeys
    ? resourceKeysValid
      ? rawResourceKeys as string[]
      : ['']
    : undefined;

  return {
    eventKnown: candidate.eventKnown === true && resourceKeysValid,
    snapshotFresh: candidate.snapshotFresh === true,
    resourceKeys,
    requiresSharedMetadata: candidate.requiresSharedMetadata === true,
    affectsEntireSubsystem: candidate.affectsEntireSubsystem === true,
    purge: candidate.purge === true,
  };
}

/** Resolve the persisted queue scope using the shared conservative planner. */
export function planQueuedAgentRun(value: unknown): ExecutionPlan {
  return planExecution(parseAgentRunExecutionChange(value));
}

/** Keep execution scope visible to every reasoning brain and in the durable run result. */
export function buildAgentRunExecutionPrompt(objective: string, plan: ExecutionPlan): string {
  const scope = plan.kind === 'full'
    ? 'FULL RECONCILIATION: inspect the complete relevant task context; do not assume a narrower scope.'
    : plan.kind === 'purge'
      ? 'PURGE: verify the desired removal state and all authorization constraints before proposing removal.'
      : plan.kind === 'targeted-with-metadata'
        ? 'TARGETED WITH SHARED METADATA: cover these resources and their shared metadata: ' + plan.resourceKeys.join(', ')
        : 'TARGETED: limit proposed work to these verified resources: ' + plan.resourceKeys.join(', ');

  return [
    'EXECUTION PLAN: ' + plan.kind,
    'PLAN REASON: ' + plan.reason,
    'SCOPE RULE: ' + scope,
    'This plan is a work-scope hint, not authorization. Do not perform writes, merges, deployments, migrations, secret changes, or external side effects without the RyanAI control plane and required human approval.',
    '',
    'TASK OBJECTIVE:',
    objective,
  ].join('\n');
}

import { PA_DELEGATION_CAPABILITIES, type PADelegationCapability } from './paJarvisHandshake.js';

export interface PAExecutionScope { delegationId: string; capabilities: PADelegationCapability[]; }
/** Parse PA delegation metadata as untrusted persisted data; partial or widened scopes fail closed. */
export function parsePAExecutionScope(value: unknown): PAExecutionScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasDelegationId = Object.prototype.hasOwnProperty.call(candidate, 'paDelegationId');
  const hasCapabilities = Object.prototype.hasOwnProperty.call(candidate, 'capabilities');
  if (!hasDelegationId && !hasCapabilities) return null;
  if (typeof candidate.paDelegationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.paDelegationId) ||
      !Array.isArray(candidate.capabilities) || candidate.capabilities.length < 1 ||
      candidate.capabilities.length > PA_DELEGATION_CAPABILITIES.length ||
      candidate.capabilities.some((item) => typeof item !== 'string' || !PA_DELEGATION_CAPABILITIES.includes(item as PADelegationCapability)) ||
      new Set(candidate.capabilities).size !== candidate.capabilities.length) {
    throw new Error('PA execution scope is malformed or outside the capability allowlist.');
  }
  return { delegationId: candidate.paDelegationId, capabilities: candidate.capabilities as PADelegationCapability[] };
}
