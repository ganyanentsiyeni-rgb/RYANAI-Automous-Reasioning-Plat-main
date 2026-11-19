import { RYANAI_MODULE_AGENT_ROSTER } from './moduleAgentRegistry.js';

export type MissionComplexity = 'low' | 'medium' | 'high' | 'critical';
export interface MissionTaskDefinition { id: string; taskType: string; complexity: MissionComplexity; dependsOn: string[]; }
export interface MissionBudget {
  maxConcurrentWorkers: number; maxModelCalls: number; maxTokens: number;
  maxRuntimeMs: number; maxInfrastructureCostUsd: number;
}
export interface MissionUsage { modelCalls: number; tokens: number; runtimeMs: number; infrastructureCostUsd: number; }
export interface MissionPlanningInput {
  tasks: MissionTaskDefinition[]; completedTaskIds?: string[]; availableAgentIds?: string[];
  availableSpecialistIds?: string[]; budget: MissionBudget; usage?: MissionUsage; availableExecutionSlots?: number;
}
export interface MissionWorkerAssignment {
  taskId: string; accountableAgentId: string; accountableAgentName: string; specialistWorkerId: string | null;
}
export interface MissionSwarmPlan {
  state: 'ready' | 'waiting_for_dependencies' | 'budget_exhausted' | 'no_workers_available';
  recommendedConcurrency: number; readyTaskIds: string[]; unassignedTaskIds: string[]; assignments: MissionWorkerAssignment[];
  evaluator: { id: 'mission-evaluator'; independent: true; mayApproveExecution: false };
  budgetRemaining: MissionUsage; reasons: string[];
}
const COMPLEXITY_WEIGHT: Record<MissionComplexity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const ZERO_USAGE: MissionUsage = { modelCalls: 0, tokens: 0, runtimeMs: 0, infrastructureCostUsd: 0 };

function validateBudget(budget: MissionBudget): string[] {
  const errors: string[] = [];
  for (const key of ['maxConcurrentWorkers', 'maxModelCalls', 'maxTokens', 'maxRuntimeMs', 'maxInfrastructureCostUsd'] as const) {
    if (!Number.isFinite(budget[key]) || budget[key] < 0) errors.push('Invalid mission budget: ' + key);
  }
  if (budget.maxConcurrentWorkers < 1) errors.push('Mission must permit at least one worker.');
  return errors;
}
function assertAcyclicTasks(tasks: readonly MissionTaskDefinition[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length || tasks.some((task) => !task.id.trim())) throw new Error('Mission task IDs must be unique and non-empty.');
  for (const task of tasks) {
    if (!task.taskType.trim() || !Object.hasOwn(COMPLEXITY_WEIGHT, task.complexity) || !Array.isArray(task.dependsOn)) {
      throw new Error('Mission task definition is invalid: ' + task.id);
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Mission task dependency graph contains a cycle.');
    if (visited.has(id)) return;
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('Mission dependency references an unknown task: ' + id);
    visiting.add(id);
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error('Mission dependency references an unknown task: ' + dependency);
      visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}
export function remainingMissionBudget(budget: MissionBudget, usage: MissionUsage = ZERO_USAGE): MissionUsage {
  return {
    modelCalls: Math.max(0, budget.maxModelCalls - usage.modelCalls),
    tokens: Math.max(0, budget.maxTokens - usage.tokens),
    runtimeMs: Math.max(0, budget.maxRuntimeMs - usage.runtimeMs),
    infrastructureCostUsd: Math.max(0, budget.maxInfrastructureCostUsd - usage.infrastructureCostUsd),
  };
}
/** Preflight only. The provider gateway and durable ledger must enforce limits atomically. */
export function canStartMissionWork(budget: MissionBudget, usage: MissionUsage, estimate: Partial<MissionUsage> = {}) {
  const remaining = remainingMissionBudget(budget, usage); const reasons: string[] = [];
  if (remaining.modelCalls < (estimate.modelCalls ?? 1)) reasons.push('model-call budget exhausted');
  if (remaining.tokens < (estimate.tokens ?? 0)) reasons.push('token budget exhausted');
  if (remaining.runtimeMs < (estimate.runtimeMs ?? 0)) reasons.push('runtime budget exhausted');
  if (remaining.infrastructureCostUsd < (estimate.infrastructureCostUsd ?? 0)) reasons.push('infrastructure-cost budget exhausted');
  return { allowed: reasons.length === 0, reasons };
}
export function planMissionSwarm(input: MissionPlanningInput): MissionSwarmPlan {
  const errors = validateBudget(input.budget); if (errors.length) throw new Error(errors.join('; '));
  assertAcyclicTasks(input.tasks);
  const usage = input.usage ?? ZERO_USAGE; const remaining = remainingMissionBudget(input.budget, usage);
  const completed = new Set(input.completedTaskIds ?? []);
  const allowed = new Set(input.availableAgentIds ?? RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.id));
  const agents = RYANAI_MODULE_AGENT_ROSTER.filter((agent) => allowed.has(agent.id));
  const ready = input.tasks.filter((task) => !completed.has(task.id) && task.dependsOn.every((id) => completed.has(id)));
  const ownedReady = ready.filter((task) => agents.some((agent) => agent.taskTypes.includes(task.taskType)));
  const unassignedTaskIds = ready.filter((task) => !agents.some((agent) => agent.taskTypes.includes(task.taskType))).map((task) => task.id);
  const evaluator = { id: 'mission-evaluator' as const, independent: true as const, mayApproveExecution: false as const };
  if (remaining.modelCalls <= 0 || remaining.tokens <= 0 || remaining.runtimeMs <= 0 || remaining.infrastructureCostUsd <= 0) {
    return { state: 'budget_exhausted', recommendedConcurrency: 0, readyTaskIds: [], unassignedTaskIds, assignments: [], evaluator,
      budgetRemaining: remaining, reasons: ['Mission budget is exhausted; no additional worker may be dispatched.'] };
  }
  if (!ready.length) return { state: input.tasks.length ? 'waiting_for_dependencies' : 'ready',
    recommendedConcurrency: 0, readyTaskIds: [], unassignedTaskIds: [], assignments: [], evaluator, budgetRemaining: remaining,
    reasons: ['No task is currently dependency-ready.'] };
  const slots = input.availableExecutionSlots ?? input.budget.maxConcurrentWorkers;
  if (!Number.isFinite(slots) || slots < 0) throw new Error('Available execution slots must be a finite non-negative number.');
  const slotLimit = Math.min(input.budget.maxConcurrentWorkers, slots, remaining.modelCalls, agents.length);
  if (slotLimit <= 0 || agents.length === 0) return { state: 'no_workers_available',
    recommendedConcurrency: 0, readyTaskIds: ready.map((task) => task.id), unassignedTaskIds: ready.map((task) => task.id), assignments: [], evaluator,
    budgetRemaining: remaining, reasons: ['No eligible module agent or execution slot is available.'] };
  const weight = ownedReady.reduce((sum, task) => sum + COMPLEXITY_WEIGHT[task.complexity], 0);
  const concurrency = Math.min(ownedReady.length, slotLimit, Math.max(1, Math.ceil(Math.sqrt(weight))));
  const used = new Set<string>(); const specialistIds = input.availableSpecialistIds ?? [];
  const assignments: MissionWorkerAssignment[] = [];
  for (const task of ownedReady) {
    if (assignments.length >= concurrency) break;
    const agent = agents.find((candidate) => !used.has(candidate.id) && candidate.taskTypes.includes(task.taskType));
    if (!agent) break;
    used.add(agent.id);
    assignments.push({ taskId: task.id, accountableAgentId: agent.id, accountableAgentName: agent.name,
      specialistWorkerId: specialistIds.length ? specialistIds[assignments.length % specialistIds.length] : null });
  }
  return { state: assignments.length ? 'ready' : 'no_workers_available', recommendedConcurrency: assignments.length,
    readyTaskIds: ready.map((task) => task.id), unassignedTaskIds, assignments, evaluator, budgetRemaining: remaining,
    reasons: [
      'Concurrency is bounded by dependency-ready work, complexity, available execution slots, eligible module agents and remaining model-call budget.',
      ...(unassignedTaskIds.length ? ['Unknown or unavailable task owners are left unassigned; no fallback owner is guessed.'] : []),
    ] };
}
export function evaluateMissionResult(input: {
  acceptanceCriteria: string[]; evidence: Array<{ criterion: string; verified: boolean; reference?: string }>;
  evaluatorAgentId: string; proposerAgentId: string;
}): { state: 'verified' | 'rejected' | 'unverified'; missingCriteria: string[] } {
  if (!input.evaluatorAgentId || input.evaluatorAgentId === input.proposerAgentId)
    return { state: 'unverified', missingCriteria: input.acceptanceCriteria };
  const verified = new Set(input.evidence.filter((item) => item.verified && item.reference?.trim()).map((item) => item.criterion));
  const missingCriteria = input.acceptanceCriteria.filter((criterion) => !verified.has(criterion));
  return missingCriteria.length ? { state: 'rejected', missingCriteria } : { state: 'verified', missingCriteria: [] };
}
