import { describe, expect, it } from 'vitest';
import { RYANAI_MODULE_AGENT_COUNT, RYANAI_MODULE_AGENT_ROSTER, findModuleAgentForTask } from './moduleAgentRegistry.js';
import { canStartMissionWork, evaluateMissionResult, planMissionSwarm } from './missionControl.js';
const budget = { maxConcurrentWorkers: 8, maxModelCalls: 20, maxTokens: 100_000, maxRuntimeMs: 600_000, maxInfrastructureCostUsd: 2 };

describe('RyanAI module workforce', () => {
  it('contains exactly thirteen unique module identities', () => {
    expect(RYANAI_MODULE_AGENT_COUNT).toBe(13);
    expect(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.id)).size).toBe(13);
    expect(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.moduleId)).size).toBe(13);
  });
  it('resolves accountable owners and rejects unknown task types', () => {
    expect(findModuleAgentForTask('ci-diagnostics')?.id).toBe('github-module-agent');
    expect(findModuleAgentForTask('quant-research')?.id).toBe('quant-module-agent');
    expect(findModuleAgentForTask('studio.plan')?.id).toBe('studio-module-agent');
    expect(findModuleAgentForTask('unknown-task')).toBeNull();
  });
  it('keeps declared actions inside the safe registry capability set', () => {
    const safe = new Set(['module.read', 'health.inspect', 'task.propose', 'diagnostics.run', 'tests.run', 'evidence.record', 'patch.propose']);
    for (const agent of RYANAI_MODULE_AGENT_ROSTER) for (const action of agent.allowedActions) expect(safe.has(action)).toBe(true);
  });
});
describe('mission swarm planning', () => {
  it('sizes concurrency to ready work and available capacity', () => {
    const plan = planMissionSwarm({ budget, availableExecutionSlots: 3, tasks: [
      { id: 'a', taskType: 'ci-diagnostics', complexity: 'high', dependsOn: [] },
      { id: 'b', taskType: 'model-benchmark', complexity: 'medium', dependsOn: [] },
      { id: 'c', taskType: 'cockpit-health-audit', complexity: 'low', dependsOn: [] },
      { id: 'd', taskType: 'studio-workflow-audit', complexity: 'low', dependsOn: ['a'] },
    ] });
    expect(plan.state).toBe('ready'); expect(plan.recommendedConcurrency).toBe(3);
    expect(plan.assignments).toHaveLength(3); expect(plan.readyTaskIds).toEqual(['a', 'b', 'c']);
  });
  it('does not dispatch a dependent task before its prerequisite completes', () => {
    const plan = planMissionSwarm({ budget, tasks: [
      { id: 'child', taskType: 'studio-workflow-audit', complexity: 'high', dependsOn: ['parent'] },
      { id: 'parent', taskType: 'ci-diagnostics', complexity: 'medium', dependsOn: [] },
    ] });
    expect(plan.readyTaskIds).toEqual(['parent']); expect(plan.assignments.map((item) => item.taskId)).toEqual(['parent']);
  });
  it('does not guess an owner for an unknown task type', () => {
    const plan = planMissionSwarm({ budget, tasks: [
      { id: 'unknown', taskType: 'unregistered-task', complexity: 'medium', dependsOn: [] },
    ] });
    expect(plan.state).toBe('no_workers_available');
    expect(plan.assignments).toEqual([]);
    expect(plan.unassignedTaskIds).toEqual(['unknown']);
  });
  it('stops dispatch when model-call budget is exhausted', () => {
    const plan = planMissionSwarm({ budget, usage: { modelCalls: 20, tokens: 100, runtimeMs: 100, infrastructureCostUsd: 0.1 },
      tasks: [{ id: 'a', taskType: 'ci-diagnostics', complexity: 'high', dependsOn: [] }] });
    expect(plan.state).toBe('budget_exhausted'); expect(plan.recommendedConcurrency).toBe(0);
  });
  it('rejects unknown dependencies and cycles', () => {
    expect(() => planMissionSwarm({ budget, tasks: [{ id: 'a', taskType: 'ci-diagnostics', complexity: 'low', dependsOn: ['missing'] }] })).toThrow(/unknown task/);
    expect(() => planMissionSwarm({ budget, tasks: [
      { id: 'a', taskType: 'ci-diagnostics', complexity: 'low', dependsOn: ['b'] },
      { id: 'b', taskType: 'cockpit-health-audit', complexity: 'low', dependsOn: ['a'] },
    ] })).toThrow(/cycle/);
  });
  it('requires a separate evaluator and referenced evidence for every acceptance criterion', () => {
    expect(evaluateMissionResult({ acceptanceCriteria: ['tests', 'security'],
      evidence: [{ criterion: 'tests', verified: true, reference: 'run:123' }],
      evaluatorAgentId: 'mission-evaluator', proposerAgentId: 'github-module-agent' }))
      .toEqual({ state: 'rejected', missingCriteria: ['security'] });
    expect(evaluateMissionResult({ acceptanceCriteria: ['tests'],
      evidence: [{ criterion: 'tests', verified: true, reference: 'run:123' }],
      evaluatorAgentId: 'github-module-agent', proposerAgentId: 'github-module-agent' }).state).toBe('unverified');
  });
});
describe('mission budget preflight', () => {
  it('rejects estimates that exceed model, token, runtime and cost limits', () => {
    expect(canStartMissionWork(budget, { modelCalls: 19, tokens: 99_900, runtimeMs: 599_000, infrastructureCostUsd: 1.99 },
      { modelCalls: 2, tokens: 200, runtimeMs: 2_000, infrastructureCostUsd: 0.02 })).toEqual({
      allowed: false, reasons: ['model-call budget exhausted', 'token budget exhausted', 'runtime budget exhausted', 'infrastructure-cost budget exhausted'],
    });
  });
});
