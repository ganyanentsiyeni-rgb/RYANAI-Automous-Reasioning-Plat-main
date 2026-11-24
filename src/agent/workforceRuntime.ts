/**
 * Runtime workforce contract.
 *
 * The registries are authoritative for the expected RyanAI workforce shape:
 * twelve module agents and ten specialist workers. This module deliberately
 * does not turn registry entries into false "live" claims; runtime evidence
 * must come from authenticated heartbeats, queue connectivity, assignments,
 * execution, completion, and provider health.
 */
import { RYANAI_MODULE_AGENT_COUNT, RYANAI_MODULE_AGENT_ROSTER } from './moduleAgentRegistry.js';
import { RYANAI_WORKER_COUNT, RYANAI_WORKER_ROSTER } from './workerRegistry.js';

export interface WorkforceContractSnapshot {
  moduleAgentCount: number;
  workerCount: number;
  moduleAgentIds: readonly string[];
  workerIds: readonly string[];
  contractValid: boolean;
}

export function getWorkforceContractSnapshot(): WorkforceContractSnapshot {
  const moduleAgentIds = RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.id);
  const workerIds = RYANAI_WORKER_ROSTER.map((worker) => worker.id);
  const uniqueModuleAgentIds = new Set(moduleAgentIds);
  const uniqueWorkerIds = new Set(workerIds);
  const contractValid =
    moduleAgentIds.length === RYANAI_MODULE_AGENT_COUNT &&
    workerIds.length === RYANAI_WORKER_COUNT &&
    uniqueModuleAgentIds.size === RYANAI_MODULE_AGENT_COUNT &&
    uniqueWorkerIds.size === RYANAI_WORKER_COUNT;

  return Object.freeze({
    moduleAgentCount: moduleAgentIds.length,
    workerCount: workerIds.length,
    moduleAgentIds: Object.freeze([...moduleAgentIds]),
    workerIds: Object.freeze([...workerIds]),
    contractValid,
  });
}
