import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCheck, summarizeChecks, redactEnvironment, classifyGovernanceResponse } from './ryanai-self-patch-audit.mjs';

test('classifies successful, failed and pending workflow checks distinctly', () => {
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'success' }), 'passed');
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'failure' }), 'failed');
  assert.equal(classifyCheck({ status: 'queued' }), 'queued');
  assert.equal(classifyCheck({ status: 'in_progress' }), 'in_progress');
  assert.equal(classifyCheck({ status: 'completed', conclusion: 'skipped' }), 'skipped');
  assert.equal(classifyCheck(null), 'missing');
});
test('never reports a green state when a check is skipped, queued or missing', () => {
  assert.equal(summarizeChecks([{ name: 'required', status: 'completed', conclusion: 'skipped' }], 'success').overall, 'pending');
  assert.equal(summarizeChecks([{ name: 'required', status: 'queued' }], 'success').overall, 'pending');
  assert.equal(summarizeChecks([], 'success').overall, 'no-data');
});
test('reports pass only when every observed check and combined status pass', () => {
  const result = summarizeChecks([
    { name: 'build', status: 'completed', conclusion: 'success' },
    { name: 'security', status: 'completed', conclusion: 'success' },
  ], 'success');
  assert.equal(result.overall, 'passing');
  assert.equal(result.counts.passed, 2);
});
test('failure dominates successful combined status', () => {
  const result = summarizeChecks([{ name: 'test', status: 'completed', conclusion: 'failure' }], 'success');
  assert.equal(result.overall, 'failing');
});
test('environment inventory exposes presence only, never values', () => {
  const result = redactEnvironment({
    GITHUB_TOKEN: 'ghs-private', GH_ADMIN_TOKEN: 'github_pat_private',
    DATABASE_URL: 'postgres://private', NODE_ENV: 'production', EMPTY_SETTING: '',
  });
  assert.deepEqual(result.GITHUB_TOKEN, { configured: true, valueExposed: false });
  assert.deepEqual(result.GH_ADMIN_TOKEN, { configured: true, valueExposed: false });
  assert.deepEqual(result.DATABASE_URL, { configured: true, valueExposed: false });
  assert.deepEqual(result.NODE_ENV, { configured: true, valueExposed: false });
  assert.deepEqual(result.EMPTY_SETTING, { configured: false, valueExposed: false });
  assert.equal(JSON.stringify(result).includes('ghs-private'), false);
  assert.equal(JSON.stringify(result).includes('github_pat_private'), false);
});
test('classifies governance API responses without treating denied access as success', () => {
  assert.equal(classifyGovernanceResponse(200), 'available');
  assert.equal(classifyGovernanceResponse(403), 'permission_blocked');
  assert.equal(classifyGovernanceResponse(404), 'not_configured');
  assert.equal(classifyGovernanceResponse(401), 'unauthorized');
  assert.equal(classifyGovernanceResponse(500), 'error');
});
