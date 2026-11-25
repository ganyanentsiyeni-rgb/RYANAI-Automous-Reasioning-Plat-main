import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RYANAI_WORKER_ROSTER,
  RYANAI_WORKER_COUNT,
  getWorkerProfile,
  findWorkerForTask,
} from '../src/agent/workerRegistry.ts';
import {
  RYANAI_MODULE_AGENT_ROSTER,
  RYANAI_MODULE_AGENT_COUNT,
  getModuleAgentProfile,
  getModuleAgentForModule,
  findModuleAgentForTask,
} from '../src/agent/moduleAgentRegistry.ts';

const forbidden = /(^|[-_.])(deploy|production|migration|secret|credential|send|dispatch|merge|permission|authorize|brokerage|live-order)s?([-_.]|$)/i;
// Read-only actions that name a forbidden noun but cannot mutate state. Kept as an explicit list so a
// blanket "read-" prefix does not also exempt reads of credentials or secrets.
const reviewedReadOnlyActions = new Set(['read-migration-files']);
const isSafeAction = (action) => reviewedReadOnlyActions.has(action) || !forbidden.test(action);
const requiredWorkerIds = [
  'coordinator', 'repository-auditor', 'ci-diagnostics', 'security-auditor',
  'runtime-infrastructure', 'data-queue', 'provider-verification',
  'communications', 'frontend-accessibility', 'release-readiness',
];

test('benchmark: shared worker roster has ten unique, accountable workers', () => {
  assert.equal(RYANAI_WORKER_COUNT, 10);
  assert.equal(RYANAI_WORKER_ROSTER.length, RYANAI_WORKER_COUNT);
  assert.deepEqual(RYANAI_WORKER_ROSTER.map((worker) => worker.id), requiredWorkerIds);
  assert.equal(new Set(RYANAI_WORKER_ROSTER.map((worker) => worker.id)).size, RYANAI_WORKER_COUNT);
  for (const worker of RYANAI_WORKER_ROSTER) {
    assert.ok(worker.name.trim());
    assert.ok(worker.responsibility.trim());
    assert.ok(worker.taskTypes.length > 0);
    assert.ok(worker.allowedActions.length > 0);
    assert.ok(worker.allowedActions.every(isSafeAction), worker.id);
  }
});

test('benchmark: module workforce has thirteen unique owners and safe bounded actions', () => {
  assert.equal(RYANAI_MODULE_AGENT_COUNT, 13);
  assert.equal(RYANAI_MODULE_AGENT_ROSTER.length, RYANAI_MODULE_AGENT_COUNT);
  assert.equal(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.id)).size, 13);
  assert.equal(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.moduleId)).size, 13);
  for (const agent of RYANAI_MODULE_AGENT_ROSTER) {
    assert.ok(agent.name.trim());
    assert.ok(agent.responsibility.trim());
    assert.ok(agent.taskTypes.length > 0);
    assert.ok(agent.kpis.length > 0);
    assert.ok(agent.allowedActions.length > 0);
    assert.ok(agent.allowedActions.every(isSafeAction), agent.id);
  }
});

test('benchmark: every module ID resolves to exactly its accountable owner', () => {
  for (const agent of RYANAI_MODULE_AGENT_ROSTER) {
    assert.equal(getModuleAgentForModule(agent.moduleId)?.id, agent.id);
    assert.equal(getModuleAgentProfile(agent.id)?.moduleId, agent.moduleId);
  }
});

test('benchmark: task routing is deterministic and unknown tasks fail closed', () => {
  assert.equal(getWorkerProfile('repository-auditor')?.id, 'repository-auditor');
  assert.equal(findWorkerForTask('ci-failure')?.id, 'ci-diagnostics');
  assert.equal(findModuleAgentForTask('comms-readiness-audit')?.id, 'comms-module-agent');
  assert.equal(findModuleAgentForTask('model-benchmark')?.id, 'inference-module-agent');
  assert.equal(findModuleAgentForTask('ai-inspector.audit')?.id, 'ai-inspector-module-agent');
  assert.equal(findWorkerForTask('ai-inspector.audit')?.id, 'repository-auditor');
  assert.equal(getWorkerProfile('unknown-worker'), null);
  assert.equal(getModuleAgentProfile('unknown-agent'), null);
  assert.equal(getModuleAgentForModule('unknown-module'), null);
  assert.equal(findWorkerForTask('unregistered-task'), null);
  assert.equal(findModuleAgentForTask('unregistered-task'), null);
});

test('benchmark: workforce identities and routing are stable across repeated reads', () => {
  const first = RYANAI_WORKER_ROSTER.map((worker) => [worker.id, ...worker.taskTypes]);
  const second = RYANAI_WORKER_ROSTER.map((worker) => [worker.id, ...worker.taskTypes]);
  assert.deepEqual(first, second);
  const moduleFirst = RYANAI_MODULE_AGENT_ROSTER.map((agent) => [agent.id, agent.moduleId, ...agent.taskTypes]);
  const moduleSecond = RYANAI_MODULE_AGENT_ROSTER.map((agent) => [agent.id, agent.moduleId, ...agent.taskTypes]);
  assert.deepEqual(moduleFirst, moduleSecond);
});

test('benchmark: read-only exception covers only the reviewed migration-file read', () => {
  assert.deepEqual([...reviewedReadOnlyActions], ['read-migration-files']);
  assert.equal(isSafeAction('read-migration-files'), true);
  assert.equal(isSafeAction('read-credentials'), false);
  assert.equal(isSafeAction('read-secrets'), false);
  assert.equal(isSafeAction('apply-migration'), false);
});
