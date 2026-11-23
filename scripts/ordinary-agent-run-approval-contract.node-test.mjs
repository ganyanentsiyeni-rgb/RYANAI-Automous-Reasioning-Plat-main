import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync('src/server/routes/agentOperations.ts', 'utf8');

test('ordinary AgentRun approval endpoints exist and require admin authentication', () => {
  assert.match(routes, /\/api\/agent\/ops\/approvals\/pending/);
  assert.match(routes, /\/api\/agent\/ops\/tasks\/:id\/approve/);
  assert.match(routes, /\/api\/agent\/ops\/tasks\/:id\/reject/);
  assert.match(routes, /request\.authUser\.role !== 'admin'/);
});

test('ordinary AgentRun approval is fail-closed and plan-bound', () => {
  assert.match(routes, /approvalStatus: 'pending'/);
  assert.match(routes, /status: 'queued', approvalStatus: 'pending'/);
  assert.match(routes, /planSnapshot !== null/);
  assert.match(routes, /approvedPlanHash/);
  assert.match(routes, /approvedCommitSha/);
  assert.match(routes, /approvedDiffHash/);
});

test('ordinary AgentRun approval records immutable evidence and uses CAS', () => {
  assert.match(routes, /updateMany/);
  assert.match(routes, /eventType: 'approval\.approved'/);
  assert.match(routes, /eventType: 'approval\.rejected'/);
  assert.match(routes, /appendRunEvidence/);
});
