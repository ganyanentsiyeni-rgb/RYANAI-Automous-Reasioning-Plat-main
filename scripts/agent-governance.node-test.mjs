import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAgentGovernancePolicy } from './validate-agent-governance.mjs';

const policy = JSON.parse(fs.readFileSync(new URL('../governance/agent-governance-policy.json', import.meta.url), 'utf8'));

test('the checked-in agent governance policy satisfies runtime tool registry contracts', () => {
  assert.deepEqual(validateAgentGovernancePolicy(policy), { valid: true, errors: [] });
});

test('governance explicitly distinguishes policy contracts from runtime enforcement', () => {
  assert.equal(policy.runtime_enforcement.profile_enforcement_status, 'CONTRACT_ONLY');
  assert.equal(policy.runtime_enforcement.sandbox_status, 'NOT_ISOLATED');
  assert.equal(policy.tool_policy.run_project_checks.decision, 'ALLOW_IF_OPERATOR_ALLOWLISTED_IN_TRUSTED_LOCAL_RUNTIME');
});

test('governance fails closed if model or agent authority is expanded', () => {
  const unsafe = structuredClone(policy);
  unsafe.authority.agents_may_deploy = true;
  unsafe.default_decision = 'ALLOW';
  const result = validateAgentGovernancePolicy(unsafe);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('agents_may_deploy')));
  assert.ok(result.errors.includes('default_decision must be DENY'));
});

test('governance fails if runtime tools are omitted or their capability drifts', () => {
  const drifted = structuredClone(policy);
  delete drifted.tool_policy.repository_status;
  drifted.tool_policy.platform_health.capability = 'network.unrestricted';
  const result = validateAgentGovernancePolicy(drifted);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('repository_status is missing')));
  assert.ok(result.errors.some((error) => error.includes('platform_health capability')));
});

test('audit policy cannot claim persistence or retain sensitive payloads prematurely', () => {
  const unsafe = structuredClone(policy);
  unsafe.audit.persistence_status = 'IMPLEMENTED';
  unsafe.audit.secret_values_recorded = true;
  const result = validateAgentGovernancePolicy(unsafe);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('persistence status')));
  assert.ok(result.errors.some((error) => error.includes('exclude secrets')));
});
